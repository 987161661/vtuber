import type { AvatarAction, EmotionSignal } from './types.js';

export type AvatarRendererInputV1 =
  | 'audio'
  | 'text'
  | 'emotion'
  | 'action'
  | 'viseme';

export interface AvatarRendererManifestV1 {
  protocolVersion: '1.0';
  id: string;
  displayName: string;
  maturity: 'stable' | 'preview' | 'experimental';
  mode: '2d-sprite' | '2d-video' | '3d-gaussian' | 'vrm';
  quality: number;
  expectedLatencyMs: number;
  inputs: readonly AvatarRendererInputV1[];
  hardware: {
    webgpu?: boolean;
    cuda?: boolean;
    minVramGb?: number;
  };
}

export interface AvatarRenderFrameV1 {
  protocolVersion: '1.0';
  id: string;
  correlationId: string;
  sequence: number;
  at: number;
  audio?: Uint8Array;
  text?: string;
  emotion: EmotionSignal;
  actions: readonly AvatarAction[];
  visemes?: readonly { atMs: number; value: string; weight?: number }[];
}

export interface AvatarRendererHardwareV1 {
  webgpu?: boolean;
  cuda?: boolean;
  vramGb?: number;
}

export interface AvatarRenderSelectionV1 {
  availableHardware: AvatarRendererHardwareV1;
  allowExperimental: boolean;
  quality?: 'realtime' | 'balanced' | 'high';
  preferredRendererIds?: readonly string[];
}

export interface AvatarRendererAdapter {
  readonly manifest: AvatarRendererManifestV1;
  probe(
    hardware: AvatarRendererHardwareV1,
    signal: AbortSignal,
  ): Promise<boolean>;
  render(frame: AvatarRenderFrameV1, signal: AbortSignal): Promise<void>;
  interrupt(mode: 'immediate' | 'beat-boundary'): Promise<void>;
  close(): Promise<void>;
}

export interface AvatarRenderFailureV1 {
  rendererId: string;
  stage: 'probe' | 'render';
  error: unknown;
}

export interface AvatarRenderReceiptV1 {
  rendererId: string;
  fallbackUsed: boolean;
  failures: readonly AvatarRenderFailureV1[];
}

export class AvatarRenderRuntime {
  private readonly adapters = new Map<string, AvatarRendererAdapter>();
  private active?: {
    adapter: AvatarRendererAdapter;
    correlationId: string;
    controller: AbortController;
  };

  register(adapter: AvatarRendererAdapter): () => void {
    validateManifest(adapter.manifest);
    if (this.adapters.has(adapter.manifest.id)) {
      throw new Error(
        `Avatar renderer already registered: ${adapter.manifest.id}`,
      );
    }
    this.adapters.set(adapter.manifest.id, adapter);
    return () => this.adapters.delete(adapter.manifest.id);
  }

  async render(
    frame: AvatarRenderFrameV1,
    selection: AvatarRenderSelectionV1,
  ): Promise<AvatarRenderReceiptV1> {
    validateFrame(frame);
    const failures: AvatarRenderFailureV1[] = [];
    const ordered = this.orderCandidates(frame, selection);
    if (ordered.length === 0)
      throw new Error('No compatible avatar renderer is registered');

    for (const adapter of ordered) {
      const controller = new AbortController();
      try {
        const available = await adapter.probe(
          selection.availableHardware,
          controller.signal,
        );
        if (!available) {
          failures.push({
            rendererId: adapter.manifest.id,
            stage: 'probe',
            error: new Error('Renderer probe returned unavailable'),
          });
          continue;
        }
      } catch (error) {
        failures.push({
          rendererId: adapter.manifest.id,
          stage: 'probe',
          error,
        });
        continue;
      }
      try {
        await adapter.render(cloneFrame(frame), controller.signal);
        this.active?.controller.abort('avatar renderer replaced');
        this.active = {
          adapter,
          correlationId: frame.correlationId,
          controller,
        };
        return {
          rendererId: adapter.manifest.id,
          fallbackUsed: failures.length > 0,
          failures,
        };
      } catch (error) {
        controller.abort('avatar render failed');
        failures.push({
          rendererId: adapter.manifest.id,
          stage: 'render',
          error,
        });
      }
    }
    throw new Error(
      `All avatar renderers failed: ${failures
        .map(
          (failure) =>
            `${failure.rendererId}/${failure.stage}: ${String(failure.error)}`,
        )
        .join('; ')}`,
    );
  }

  async interrupt(mode: 'immediate' | 'beat-boundary'): Promise<boolean> {
    if (!this.active) return false;
    if (mode === 'immediate')
      this.active.controller.abort('avatar interruption');
    await this.active.adapter.interrupt(mode);
    return true;
  }

  async close(): Promise<void> {
    this.active?.controller.abort('avatar runtime closed');
    this.active = undefined;
    await Promise.all(
      [...this.adapters.values()].map((adapter) => adapter.close()),
    );
  }

  private orderCandidates(
    frame: AvatarRenderFrameV1,
    selection: AvatarRenderSelectionV1,
  ): AvatarRendererAdapter[] {
    const requiredInputs = requiredInputsForFrame(frame);
    const preferred = new Map(
      (selection.preferredRendererIds ?? []).map((id, index) => [id, index]),
    );
    const activeId =
      this.active?.correlationId === frame.correlationId
        ? this.active.adapter.manifest.id
        : undefined;
    return [...this.adapters.values()]
      .filter(
        (adapter) =>
          (selection.allowExperimental ||
            adapter.manifest.maturity !== 'experimental') &&
          requiredInputs.every((input) =>
            adapter.manifest.inputs.includes(input),
          ) &&
          supportsDrivingInput(adapter.manifest, frame) &&
          hardwareMatches(adapter.manifest, selection.availableHardware),
      )
      .sort((left, right) => {
        if (left.manifest.id === activeId) return -1;
        if (right.manifest.id === activeId) return 1;
        const leftPreferred = preferred.get(left.manifest.id);
        const rightPreferred = preferred.get(right.manifest.id);
        if (leftPreferred !== undefined || rightPreferred !== undefined) {
          return (
            (leftPreferred ?? Number.MAX_SAFE_INTEGER) -
            (rightPreferred ?? Number.MAX_SAFE_INTEGER)
          );
        }
        if (selection.quality === 'high') {
          return (
            right.manifest.quality - left.manifest.quality ||
            left.manifest.expectedLatencyMs - right.manifest.expectedLatencyMs
          );
        }
        if (selection.quality === 'balanced') {
          const leftScore =
            left.manifest.quality - left.manifest.expectedLatencyMs / 1_000;
          const rightScore =
            right.manifest.quality - right.manifest.expectedLatencyMs / 1_000;
          return rightScore - leftScore;
        }
        return (
          maturityRank(left.manifest.maturity) -
            maturityRank(right.manifest.maturity) ||
          left.manifest.expectedLatencyMs - right.manifest.expectedLatencyMs
        );
      });
  }
}

export interface CallbackAvatarRendererHandlers {
  probe?: (
    hardware: AvatarRendererHardwareV1,
    signal: AbortSignal,
  ) => Promise<boolean> | boolean;
  render: (frame: AvatarRenderFrameV1, signal: AbortSignal) => Promise<void>;
  interrupt?: (mode: 'immediate' | 'beat-boundary') => Promise<void>;
  close?: () => Promise<void>;
}

/** Adapter for the existing Purupuru/VRM in-process render callbacks. */
export class CallbackAvatarRendererAdapter implements AvatarRendererAdapter {
  readonly manifest: AvatarRendererManifestV1;
  private readonly handlers: CallbackAvatarRendererHandlers;

  constructor(
    manifest: AvatarRendererManifestV1,
    handlers: CallbackAvatarRendererHandlers,
  ) {
    this.manifest = manifest;
    this.handlers = handlers;
  }

  async probe(
    hardware: AvatarRendererHardwareV1,
    signal: AbortSignal,
  ): Promise<boolean> {
    return (await this.handlers.probe?.(hardware, signal)) ?? true;
  }

  render(frame: AvatarRenderFrameV1, signal: AbortSignal): Promise<void> {
    return this.handlers.render(frame, signal);
  }

  async interrupt(mode: 'immediate' | 'beat-boundary'): Promise<void> {
    await this.handlers.interrupt?.(mode);
  }

  async close(): Promise<void> {
    await this.handlers.close?.();
  }
}

export interface RemoteAvatarRendererTransport {
  probe(
    manifest: AvatarRendererManifestV1,
    hardware: AvatarRendererHardwareV1,
    signal: AbortSignal,
  ): Promise<boolean>;
  render(
    manifest: AvatarRendererManifestV1,
    frame: AvatarRenderFrameV1,
    signal: AbortSignal,
  ): Promise<void>;
  interrupt(
    manifest: AvatarRendererManifestV1,
    mode: 'immediate' | 'beat-boundary',
  ): Promise<void>;
  close(manifest: AvatarRendererManifestV1): Promise<void>;
}

/** Shared remote adapter for MuseTalk, PersonaLive, FlashHead, or future renderers. */
export class RemoteAvatarRendererAdapter implements AvatarRendererAdapter {
  readonly manifest: AvatarRendererManifestV1;
  private readonly transport: RemoteAvatarRendererTransport;

  constructor(
    manifest: AvatarRendererManifestV1,
    transport: RemoteAvatarRendererTransport,
  ) {
    this.manifest = manifest;
    this.transport = transport;
  }

  probe(
    hardware: AvatarRendererHardwareV1,
    signal: AbortSignal,
  ): Promise<boolean> {
    return this.transport.probe(this.manifest, hardware, signal);
  }

  render(frame: AvatarRenderFrameV1, signal: AbortSignal): Promise<void> {
    return this.transport.render(this.manifest, frame, signal);
  }

  interrupt(mode: 'immediate' | 'beat-boundary'): Promise<void> {
    return this.transport.interrupt(this.manifest, mode);
  }

  close(): Promise<void> {
    return this.transport.close(this.manifest);
  }
}

function requiredInputsForFrame(
  frame: AvatarRenderFrameV1,
): AvatarRendererInputV1[] {
  return ['emotion', ...(frame.actions.length ? (['action'] as const) : [])];
}

function supportsDrivingInput(
  manifest: AvatarRendererManifestV1,
  frame: AvatarRenderFrameV1,
): boolean {
  const available: AvatarRendererInputV1[] = [
    ...(frame.audio ? (['audio'] as const) : []),
    ...(frame.text ? (['text'] as const) : []),
    ...(frame.visemes?.length ? (['viseme'] as const) : []),
  ];
  return (
    available.length === 0 ||
    available.some((input) => manifest.inputs.includes(input))
  );
}

function hardwareMatches(
  manifest: AvatarRendererManifestV1,
  hardware: AvatarRendererHardwareV1,
): boolean {
  if (manifest.hardware.webgpu && !hardware.webgpu) return false;
  if (manifest.hardware.cuda && !hardware.cuda) return false;
  if (
    manifest.hardware.minVramGb !== undefined &&
    (hardware.vramGb ?? 0) < manifest.hardware.minVramGb
  ) {
    return false;
  }
  return true;
}

function maturityRank(value: AvatarRendererManifestV1['maturity']): number {
  return value === 'stable' ? 0 : value === 'preview' ? 1 : 2;
}

function validateManifest(manifest: AvatarRendererManifestV1): void {
  if (
    manifest.protocolVersion !== '1.0' ||
    !manifest.id ||
    !manifest.displayName
  ) {
    throw new Error('Avatar renderer manifest is invalid');
  }
  if (
    manifest.quality < 0 ||
    manifest.quality > 1 ||
    manifest.expectedLatencyMs < 0
  ) {
    throw new Error(`Avatar renderer metrics are invalid: ${manifest.id}`);
  }
}

function validateFrame(frame: AvatarRenderFrameV1): void {
  if (frame.protocolVersion !== '1.0' || !frame.id || !frame.correlationId) {
    throw new Error('Avatar render frame is invalid');
  }
  if (!Number.isSafeInteger(frame.sequence) || frame.sequence < 0) {
    throw new Error('Avatar render sequence must be a non-negative integer');
  }
}

function cloneFrame(frame: AvatarRenderFrameV1): AvatarRenderFrameV1 {
  return {
    ...frame,
    ...(frame.audio ? { audio: frame.audio.slice() } : {}),
    emotion: { ...frame.emotion },
    actions: frame.actions.map((action) => ({
      ...action,
      ...(action.parameters ? { parameters: { ...action.parameters } } : {}),
    })),
    ...(frame.visemes
      ? { visemes: frame.visemes.map((viseme) => ({ ...viseme })) }
      : {}),
  };
}
