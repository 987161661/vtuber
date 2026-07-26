export interface SpeechProsodyV1 {
  rate?: number;
  pitch?: number;
  volume?: number;
  emotion?: string;
  style?: string;
}

export interface SpeechControlBeatV1 {
  text: string;
  interruptibleAfter: boolean;
  prosody?: SpeechProsodyV1;
}

export interface SpeechControlPlanV1 {
  protocolVersion: '1.0';
  id: string;
  correlationId: string;
  beats: readonly SpeechControlBeatV1[];
}

export interface SpeechAudioPacketV1 {
  protocolVersion: '1.0';
  sequence: number;
  beatIndex: number;
  audio: Uint8Array;
  sampleRate: number;
  channels: number;
  encoding: 'pcm-s16le' | 'pcm-f32le' | 'opus' | 'mp3';
  lastInBeat: boolean;
  final: boolean;
  visemes?: readonly { atMs: number; value: string; weight?: number }[];
}

export interface StreamingSpeechRenderer {
  render(
    plan: SpeechControlPlanV1,
    signal: AbortSignal,
  ): AsyncIterable<SpeechAudioPacketV1>;
}

export interface StreamingSpeechPlayer {
  open(plan: SpeechControlPlanV1): Promise<void>;
  write(packet: SpeechAudioPacketV1): Promise<void>;
  close(): Promise<void>;
  fadeOut(milliseconds: number): Promise<void>;
}

export type SpeechPlaneStageV1 =
  | 'tts-first-packet'
  | 'playback-started'
  | 'beat-completed'
  | 'completed'
  | 'interrupted'
  | 'failed';

export interface SpeechPlaneEventV1 {
  protocolVersion: '1.0';
  planId: string;
  correlationId: string;
  at: number;
  stage: SpeechPlaneStageV1;
  beatIndex?: number;
  error?: unknown;
}

export interface SpeechPlaneResultV1 {
  protocolVersion: '1.0';
  planId: string;
  status: 'completed' | 'interrupted' | 'failed';
  packetCount: number;
  startedAt: number;
  firstPacketAt?: number;
  completedAt: number;
  error?: unknown;
}

export interface StreamingSpeechPlaneOptions {
  now?: () => number;
  fadeOutMs?: number;
  onEvent?: (event: SpeechPlaneEventV1) => void;
}

interface ActiveSpeech {
  plan: SpeechControlPlanV1;
  controller: AbortController;
  interrupt?: 'immediate' | 'beat-boundary';
}

/**
 * Keeps the auditable text plan in the control plane while moving only audio
 * packets through the low-latency data plane.
 */
export class StreamingSpeechPlane {
  private readonly renderer: StreamingSpeechRenderer;
  private readonly player: StreamingSpeechPlayer;
  private readonly now: () => number;
  private readonly fadeOutMs: number;
  private readonly onEvent?: (event: SpeechPlaneEventV1) => void;
  private active?: ActiveSpeech;

  constructor(
    renderer: StreamingSpeechRenderer,
    player: StreamingSpeechPlayer,
    options: StreamingSpeechPlaneOptions = {},
  ) {
    this.renderer = renderer;
    this.player = player;
    this.now = options.now ?? Date.now;
    this.fadeOutMs = options.fadeOutMs ?? 40;
    this.onEvent = options.onEvent;
  }

  async speak(plan: SpeechControlPlanV1): Promise<SpeechPlaneResultV1> {
    validatePlan(plan);
    if (this.active) {
      throw new Error(`Speech plane is busy with ${this.active.plan.id}`);
    }
    const startedAt = this.now();
    const active: ActiveSpeech = {
      plan: clonePlan(plan),
      controller: new AbortController(),
    };
    this.active = active;
    let packetCount = 0;
    let firstPacketAt: number | undefined;
    let expectedSequence = 0;
    let status: SpeechPlaneResultV1['status'] = 'completed';
    let failure: unknown;

    try {
      await this.player.open(active.plan);
      for await (const packet of this.renderer.render(
        active.plan,
        active.controller.signal,
      )) {
        if (active.controller.signal.aborted) break;
        validatePacket(packet, active.plan, expectedSequence);
        expectedSequence += 1;
        if (firstPacketAt === undefined) {
          firstPacketAt = this.now();
          this.emit(active.plan, 'tts-first-packet', firstPacketAt);
          this.emit(active.plan, 'playback-started');
        }
        await this.player.write(packet);
        packetCount += 1;
        if (packet.lastInBeat) {
          this.emit(active.plan, 'beat-completed', undefined, packet.beatIndex);
          if (
            active.interrupt === 'beat-boundary' &&
            active.plan.beats[packet.beatIndex]?.interruptibleAfter
          ) {
            active.controller.abort('beat-boundary interruption');
            break;
          }
        }
      }
      if (active.interrupt || active.controller.signal.aborted) {
        status = 'interrupted';
        await this.player.fadeOut(this.fadeOutMs);
        this.emit(active.plan, 'interrupted');
      } else {
        this.emit(active.plan, 'completed');
      }
    } catch (error) {
      if (active.interrupt || active.controller.signal.aborted) {
        status = 'interrupted';
        await this.player.fadeOut(this.fadeOutMs);
        this.emit(active.plan, 'interrupted');
      } else {
        status = 'failed';
        failure = error;
        this.emit(active.plan, 'failed', undefined, undefined, error);
      }
    } finally {
      try {
        await this.player.close();
      } catch (closeError) {
        if (status === 'completed') {
          status = 'failed';
          failure = closeError;
          this.emit(active.plan, 'failed', undefined, undefined, closeError);
        }
      }
      this.active = undefined;
    }

    return {
      protocolVersion: '1.0',
      planId: plan.id,
      status,
      packetCount,
      startedAt,
      ...(firstPacketAt === undefined ? {} : { firstPacketAt }),
      completedAt: this.now(),
      ...(failure === undefined ? {} : { error: failure }),
    };
  }

  interrupt(mode: 'immediate' | 'beat-boundary'): boolean {
    if (!this.active) return false;
    if (this.active.interrupt === 'immediate') return true;
    this.active.interrupt = mode;
    if (mode === 'immediate') {
      this.active.controller.abort('immediate interruption');
    }
    return true;
  }

  private emit(
    plan: SpeechControlPlanV1,
    stage: SpeechPlaneStageV1,
    at = this.now(),
    beatIndex?: number,
    error?: unknown,
  ): void {
    try {
      this.onEvent?.({
        protocolVersion: '1.0',
        planId: plan.id,
        correlationId: plan.correlationId,
        at,
        stage,
        ...(beatIndex === undefined ? {} : { beatIndex }),
        ...(error === undefined ? {} : { error }),
      });
    } catch {
      // Lifecycle observation is best-effort and must not stop audio delivery.
    }
  }
}

function validatePlan(plan: SpeechControlPlanV1): void {
  if (plan.protocolVersion !== '1.0') {
    throw new Error(
      `Unsupported speech control protocol: ${plan.protocolVersion}`,
    );
  }
  if (!plan.id || !plan.correlationId) {
    throw new Error('Speech control plan requires ids');
  }
  if (plan.beats.length === 0 || plan.beats.some((beat) => !beat.text.trim())) {
    throw new Error('Speech control plan requires non-empty text beats');
  }
}

function validatePacket(
  packet: SpeechAudioPacketV1,
  plan: SpeechControlPlanV1,
  expectedSequence: number,
): void {
  if (packet.protocolVersion !== '1.0') {
    throw new Error(
      `Unsupported speech packet protocol: ${packet.protocolVersion}`,
    );
  }
  if (packet.sequence !== expectedSequence) {
    throw new Error(
      `Speech packet sequence mismatch: expected ${expectedSequence}, received ${packet.sequence}`,
    );
  }
  if (
    !Number.isSafeInteger(packet.beatIndex) ||
    !plan.beats[packet.beatIndex]
  ) {
    throw new Error(
      `Speech packet references invalid beat ${packet.beatIndex}`,
    );
  }
  if (packet.audio.byteLength === 0) throw new Error('Speech packet is empty');
}

function clonePlan(plan: SpeechControlPlanV1): SpeechControlPlanV1 {
  return {
    ...plan,
    beats: plan.beats.map((beat) => ({
      ...beat,
      ...(beat.prosody ? { prosody: { ...beat.prosody } } : {}),
    })),
  };
}
