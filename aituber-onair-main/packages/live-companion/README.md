# @aituber-onair/live-companion

Live-stream-specific companion primitives for AITubers. The package contains
no LLM client, platform SDK, database, or renderer. It defines the small core
that those integrations can share:

- five-dimensional live memory;
- known-viewer presence tracking;
- controlled proactive talk planning;
- an avatar-neutral emotion and action protocol.

## Five-dimensional live memory

The dimensions are intentionally about operating a live stream rather than
retaining an unbounded chat transcript.

| Dimension | Purpose | Typical scope |
| --- | --- | --- |
| `working` | Current topic, open poll, current game state, unresolved question | Stream, short TTL |
| `episode` | Durable timeline and memorable moments from this broadcast | Stream |
| `viewer` | Preferences, relationship continuity, previous interactions | Viewer |
| `reflection` | Post-stream lessons and hypotheses for the next broadcast | Global |
| `persona` | Stable voice, boundaries, lore, and recurring bits | Global |

Working memory expires after 15 minutes by default. Override
`defaultWorkingTtlMs` when constructing `LiveMemoryManager`, or set an explicit
`expiresAt` on an individual record.

```ts
import {
  InMemoryLiveMemoryRepository,
  LiveMemoryManager,
} from '@aituber-onair/live-companion';

const memory = new LiveMemoryManager(
  new InMemoryLiveMemoryRepository(),
);

await memory.remember({
  dimension: 'viewer',
  content: 'Mina likes puzzle games and low-pressure questions.',
  scope: { kind: 'viewer', viewerId: 'youtube:mina' },
  source: 'chat',
  salience: 0.7,
});

const promptContext = await memory.buildPromptContext({
  streamId: 'stream-2026-07-11',
  viewerId: 'youtube:mina',
});
```

Use a custom `LiveMemoryRepository` for IndexedDB, SQLite, or a remote store.
Use a custom `LiveMemoryRetriever` to add embedding or hybrid retrieval without
changing the memory model.

## Proactive talk for quiet rooms

`LivePresenceTracker` only knows identities supplied by a platform adapter.
Viewer count alone is never used to infer who is silently watching. This is
important because YouTube and Twitch integrations often expose a count but not
a complete, reliable list of viewer identities.

```ts
import {
  LivePresenceTracker,
  ProactiveTalkPlanner,
} from '@aituber-onair/live-companion';

const presence = new LivePresenceTracker();
presence.startStream('stream-2026-07-11');
presence.observe({
  kind: 'heartbeat',
  at: Date.now(),
  viewer: {
    id: 'web:mina',
    displayName: 'Mina',
    platform: 'web',
    addressable: true,
    mayMentionName: true,
  },
});

const planner = new ProactiveTalkPlanner(presence, {
  maxViewerCountForDirectAddress: 8,
  minQuietMs: 45_000,
  minViewerPresenceMs: 3 * 60_000,
  perViewerCooldownMs: 30 * 60_000,
});

const decision = planner.evaluate({
  stream: {
    streamId: 'stream-2026-07-11',
    now: Date.now(),
    startedAt: streamStartedAt,
    viewerCount: 3,
    lastAudienceMessageAt,
    lastHostSpeechAt,
    topic: 'Puzzle game',
  },
  environmentEvents: recentEnvironmentEvents,
});

if (decision) {
  // Give decision.prompt to the existing chat service.
  // Call this only after the generated line was actually delivered.
  planner.markDelivered(decision, Date.now());
}
```

The planner supplies constraints that forbid language such as "I can see you
lurking" and caps both global and per-viewer frequency. Set `doNotDisturb` on a
viewer identity to opt that viewer out completely.

## Host execution authority

`LiveHostCoordinator.dispatch` returns `LiveHostAction[]`. Every action has an
idempotency key (`actionId`), an issue time, and enough turn data for the queue,
generation, or speech consumer to execute it without reconstructing policy.
Feed generation and speech lifecycle events back into the same coordinator;
do not start playback merely because generation completed unless it emitted a
`speak-turn` action.

Provide the same `LiveHostScope` on every event to reject delayed events after
a persona or stream session switch. Unscoped events remain supported for older
integrations.

Quiet-room candidates should carry a stable `opportunityId`. Reusing a source
label is valid after cooldown; reusing an already selected opportunity id is
not. A new thought or observation must receive a new opportunity id.

```ts
const scope = {
  profileId: 'linglan',
  sessionId: 'session-2026-07-16',
  streamId: 'stream-1',
};

coordinator.dispatch({
  type: 'stream-state',
  at: Date.now(),
  isLive: true,
  scope,
});

const actions = coordinator.dispatch({
  type: 'quiet-candidate',
  at: Date.now(),
  eventId: 'candidate-12',
  opportunityId: 'empty-room-thought-12',
  source: 'empty-room-awareness',
  prompt: 'Continue the current thought without repeating the last line.',
  busy: false,
  scope,
});

for (const action of actions) {
  if (action.kind === 'prepare-reply') {
    await generationQueue.enqueue(action.turn, action.prompt, action.actionId);
  }
}
```

## Emotion to avatar behavior protocol

An application owns the emotion mapping. Implement `EmotionBehaviorMapper` to
translate an LLM emotion or stream event into protocol actions, then register
one adapter for each renderer.

```ts
import {
  AvatarBehaviorBus,
  createAvatarBehaviorEvent,
} from '@aituber-onair/live-companion';

const bus = new AvatarBehaviorBus();
bus.register(live2dAdapter);
bus.register(vrmAdapter);

const behavior = createAvatarBehaviorEvent(
  { name: 'happy', intensity: 0.8, valence: 0.9, arousal: 0.6 },
  {
    streamId: 'stream-2026-07-11',
    source: 'proactive-talk',
    speechText: generatedText,
    correlationId: proactiveDecision.id,
  },
  [
    { kind: 'expression', name: 'smile', durationMs: 2_000 },
    { kind: 'gesture', name: 'small-wave', interrupt: 'blend' },
  ],
);

const receipts = await bus.dispatch(behavior);
```

Adapters declare supported emotion names and action kinds. An incompatible
adapter is skipped, and one failed renderer does not prevent other renderers
from receiving the event.
