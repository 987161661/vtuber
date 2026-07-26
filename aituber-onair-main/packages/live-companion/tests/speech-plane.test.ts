import { describe, expect, it } from 'vitest';
import {
  StreamingSpeechPlane,
  type SpeechAudioPacketV1,
  type SpeechControlPlanV1,
  type StreamingSpeechPlayer,
  type StreamingSpeechRenderer,
} from '../src/index.js';

const plan: SpeechControlPlanV1 = {
  protocolVersion: '1.0',
  id: 'speech-1',
  correlationId: 'turn-1',
  beats: [
    {
      text: '第一句。',
      interruptibleAfter: true,
      prosody: { rate: 1, pitch: 0.1, emotion: 'warm' },
    },
    {
      text: '第二句。',
      interruptibleAfter: true,
      prosody: { rate: 0.95, pitch: 0, emotion: 'calm' },
    },
  ],
};

function packet(
  sequence: number,
  beatIndex: number,
  options: { lastInBeat?: boolean; final?: boolean } = {},
): SpeechAudioPacketV1 {
  return {
    protocolVersion: '1.0',
    sequence,
    beatIndex,
    audio: new Uint8Array([sequence]),
    sampleRate: 24_000,
    channels: 1,
    encoding: 'pcm-s16le',
    lastInBeat: options.lastInBeat ?? false,
    final: options.final ?? false,
  };
}

class RecordingPlayer implements StreamingSpeechPlayer {
  calls: string[] = [];
  packets: SpeechAudioPacketV1[] = [];

  async open(value: SpeechControlPlanV1): Promise<void> {
    this.calls.push(`open:${value.id}`);
  }

  async write(value: SpeechAudioPacketV1): Promise<void> {
    this.packets.push(value);
    this.calls.push(`write:${value.sequence}`);
  }

  async close(): Promise<void> {
    this.calls.push('close');
  }

  async fadeOut(milliseconds: number): Promise<void> {
    this.calls.push(`fade:${milliseconds}`);
  }
}

describe('StreamingSpeechPlane', () => {
  it('streams ordered audio while emitting auditable lifecycle events', async () => {
    const renderer: StreamingSpeechRenderer = {
      async *render() {
        yield packet(0, 0);
        yield packet(1, 0, { lastInBeat: true });
        yield packet(2, 1, { lastInBeat: true, final: true });
      },
    };
    const player = new RecordingPlayer();
    const events: string[] = [];
    let now = 100;
    const plane = new StreamingSpeechPlane(renderer, player, {
      now: () => now++,
      onEvent: (event) => events.push(event.stage),
    });

    const result = await plane.speak(plan);

    expect(result.status).toBe('completed');
    expect(player.packets.map((value) => value.sequence)).toEqual([0, 1, 2]);
    expect(events).toEqual([
      'tts-first-packet',
      'playback-started',
      'beat-completed',
      'beat-completed',
      'completed',
    ]);
    expect(player.calls.at(-1)).toBe('close');
  });

  it('honors beat-boundary interruption with a fade and stops later audio', async () => {
    let releaseSecondPacket!: () => void;
    const wait = new Promise<void>((resolve) => {
      releaseSecondPacket = resolve;
    });
    let markFirstPacketWritten!: () => void;
    const firstPacketWritten = new Promise<void>((resolve) => {
      markFirstPacketWritten = resolve;
    });
    const renderer: StreamingSpeechRenderer = {
      async *render(_plan, signal) {
        yield packet(0, 0);
        markFirstPacketWritten();
        await wait;
        if (signal.aborted) return;
        yield packet(1, 0, { lastInBeat: true });
        yield packet(2, 1, { lastInBeat: true, final: true });
      },
    };
    const player = new RecordingPlayer();
    const plane = new StreamingSpeechPlane(renderer, player, { fadeOutMs: 25 });

    const speaking = plane.speak(plan);
    await firstPacketWritten;
    expect(plane.interrupt('beat-boundary')).toBe(true);
    releaseSecondPacket();
    const result = await speaking;

    expect(result.status).toBe('interrupted');
    expect(player.calls).toContain('fade:25');
    expect(player.packets.map((value) => value.sequence)).toEqual([0, 1]);
  });

  it('immediately aborts a renderer and is idempotent after completion', async () => {
    let release!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started!: () => void;
    const first = new Promise<void>((resolve) => {
      started = resolve;
    });
    const renderer: StreamingSpeechRenderer = {
      async *render(_plan, signal) {
        yield packet(0, 0);
        started();
        await wait;
        if (signal.aborted) return;
        yield packet(1, 0, { lastInBeat: true, final: true });
      },
    };
    const player = new RecordingPlayer();
    const plane = new StreamingSpeechPlane(renderer, player);

    const speaking = plane.speak(plan);
    await first;
    expect(plane.interrupt('immediate')).toBe(true);
    release();
    expect((await speaking).status).toBe('interrupted');
    expect(plane.interrupt('immediate')).toBe(false);
  });
});
