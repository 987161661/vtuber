import type {
  AvatarBehaviorAdapter,
  AvatarBehaviorEvent,
  AvatarDispatchReceipt,
  EmotionBehaviorContext,
  EmotionSignal,
} from './types.js';

export class AvatarBehaviorBus {
  private adapters = new Map<string, AvatarBehaviorAdapter>();

  register(adapter: AvatarBehaviorAdapter): () => void {
    if (this.adapters.has(adapter.id)) {
      throw new Error(`Avatar adapter already registered: ${adapter.id}`);
    }
    this.adapters.set(adapter.id, adapter);
    return () => this.adapters.delete(adapter.id);
  }

  unregister(adapterId: string): boolean {
    return this.adapters.delete(adapterId);
  }

  async dispatch(event: AvatarBehaviorEvent): Promise<AvatarDispatchReceipt[]> {
    validateBehaviorEvent(event);
    return Promise.all(
      [...this.adapters.values()].map(async (adapter) => {
        if (!supportsEvent(adapter, event)) {
          return { adapterId: adapter.id, status: 'skipped' as const };
        }
        try {
          await adapter.dispatch(selectSupportedActions(adapter, event));
          return { adapterId: adapter.id, status: 'delivered' as const };
        } catch (error) {
          return {
            adapterId: adapter.id,
            status: 'failed' as const,
            error,
          };
        }
      }),
    );
  }
}

export function createAvatarBehaviorEvent(
  emotion: EmotionSignal,
  context: EmotionBehaviorContext,
  actions: AvatarBehaviorEvent['actions'],
  occurredAt = Date.now(),
): AvatarBehaviorEvent {
  return {
    protocolVersion: '1.0',
    id: `avatar-behavior-${occurredAt}-${Math.random()
      .toString(36)
      .slice(2, 10)}`,
    occurredAt,
    source: context.source,
    emotion: normalizeEmotion(emotion),
    actions: actions.map((action) => ({ ...action })),
    speechText: context.speechText,
    targetViewerId: context.targetViewerId,
    correlationId: context.correlationId,
    metadata: context.metadata,
  };
}

function supportsEvent(
  adapter: AvatarBehaviorAdapter,
  event: AvatarBehaviorEvent,
): boolean {
  if (adapter.canHandle && !adapter.canHandle(event)) return false;
  const { actionKinds, emotionNames } = adapter.capabilities;
  if (
    emotionNames !== undefined &&
    emotionNames !== '*' &&
    !emotionNames.includes(event.emotion.name)
  ) {
    return false;
  }
  if (actionKinds === '*') return true;
  return (
    event.actions.length === 0 ||
    event.actions.some((action) => actionKinds.includes(action.kind))
  );
}

function selectSupportedActions(
  adapter: AvatarBehaviorAdapter,
  event: AvatarBehaviorEvent,
): AvatarBehaviorEvent {
  if (adapter.capabilities.actionKinds === '*') return event;
  return {
    ...event,
    actions: event.actions.filter((action) =>
      adapter.capabilities.actionKinds.includes(action.kind),
    ),
  };
}

function validateBehaviorEvent(event: AvatarBehaviorEvent): void {
  if (event.protocolVersion !== '1.0') {
    throw new Error(`Unsupported avatar protocol: ${event.protocolVersion}`);
  }
  if (!event.id) throw new Error('Avatar behavior event requires an id');
  if (!event.emotion.name) {
    throw new Error('Avatar behavior event requires an emotion name');
  }
  if (event.emotion.intensity < 0 || event.emotion.intensity > 1) {
    throw new Error('Emotion intensity must be between 0 and 1');
  }
}

function normalizeEmotion(emotion: EmotionSignal): EmotionSignal {
  return {
    ...emotion,
    intensity: clamp(emotion.intensity, 0, 1),
    valence:
      emotion.valence === undefined ? undefined : clamp(emotion.valence, -1, 1),
    arousal:
      emotion.arousal === undefined ? undefined : clamp(emotion.arousal, -1, 1),
    confidence:
      emotion.confidence === undefined
        ? undefined
        : clamp(emotion.confidence, 0, 1),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
