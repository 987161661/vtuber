import {
  applyAgentPersonaDecision,
  shouldRequestPersonaAgent,
  type PersonaInteractionPlanV1,
  type PersonaPlannerInput,
  type PersonaPolicyPack,
} from './personaInteractionPlanner';

const CACHE_TTL_MS = 30_000;
const ROOM_RATE_LIMIT_MS = 2_000;
const eventRequests = new Map<string, Promise<PersonaInteractionPlanV1>>();
const sceneCache = new Map<
  string,
  { expiresAt: number; decision: unknown }
>();
let lastRoomRequestAt = 0;

function normalizedSceneKey(
  input: PersonaPlannerInput,
  plan: PersonaInteractionPlanV1,
): string {
  return [
    plan.scene,
    input.routing.mode,
    input.room?.conflictLevel ?? 'single',
    input.room?.ambiguous ? 'ambiguous' : 'clear',
    input.text
      .normalize('NFKC')
      .toLowerCase()
      .replace(/@[^\s，。！？,.!?]+/gu, '@viewer')
      .replace(/\d+/g, '#')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 160),
  ].join('|');
}

function fallback(
  plan: PersonaInteractionPlanV1,
  reasonCode: string,
): PersonaInteractionPlanV1 {
  return { ...plan, source: 'fallback', reasonCode };
}

async function requestDecision(
  input: PersonaPlannerInput,
  plan: PersonaInteractionPlanV1,
  policy: PersonaPolicyPack,
): Promise<PersonaInteractionPlanV1> {
  const now = Date.now();
  const key = normalizedSceneKey(input, plan);
  const cached = sceneCache.get(key);
  if (cached && cached.expiresAt > now) {
    return (
      applyAgentPersonaDecision(plan, cached.decision, input, policy) ??
      fallback(plan, 'agent_cache_invalid')
    );
  }
  if (cached) sceneCache.delete(key);
  if (input.room && now - lastRoomRequestAt < ROOM_RATE_LIMIT_MS) {
    return fallback(plan, 'agent_room_rate_limited');
  }
  if (input.room) lastRoomRequestAt = now;

  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), 2_000);
  try {
    const response = await fetch('/api/persona-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        eventId: input.eventId,
        text: input.text.slice(0, 500),
        routing: {
          mode: input.routing.mode,
          intent: input.routing.intent,
          moderation: input.routing.moderation,
        },
        relationship: input.relationship,
        localPlan: {
          scene: plan.scene,
          stance: plan.stance,
          primaryMove: plan.primaryMove,
          confidence: plan.confidence,
          reasonCode: plan.reasonCode,
        },
        room: input.room
          ? {
              totalCount: input.room.totalCount,
              participantCount: input.room.participantCount,
              conflictLevel: input.room.conflictLevel,
              ambiguous: input.room.ambiguous,
              samples: input.room.samples.slice(0, 4).map((sample) => ({
                viewerId: sample.viewerId,
                text: sample.text.slice(0, 180),
                hostile: sample.hostile,
                threat: sample.threat,
                targetViewerId: sample.targetViewerId,
              })),
            }
          : undefined,
      }),
    });
    if (!response.ok) return fallback(plan, `agent_http_${response.status}`);
    const value = (await response.json()) as unknown;
    const refined = applyAgentPersonaDecision(plan, value, input, policy);
    if (!refined) return fallback(plan, 'agent_invalid_json');
    sceneCache.set(key, { expiresAt: now + CACHE_TTL_MS, decision: value });
    return refined;
  } catch (error) {
    return fallback(
      plan,
      error instanceof DOMException && error.name === 'AbortError'
        ? 'agent_timeout'
        : 'agent_request_failed',
    );
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

export function refinePersonaPlanWithAgent(
  input: PersonaPlannerInput,
  plan: PersonaInteractionPlanV1,
  policy: PersonaPolicyPack,
): Promise<PersonaInteractionPlanV1> {
  if (!shouldRequestPersonaAgent(plan, input.room)) return Promise.resolve(plan);
  const existing = eventRequests.get(input.eventId);
  if (existing) return existing;
  const request = requestDecision(input, plan, policy).finally(() => {
    globalThis.setTimeout(() => eventRequests.delete(input.eventId), CACHE_TTL_MS);
  });
  eventRequests.set(input.eventId, request);
  return request;
}

export function resetPersonaPlanningAgentState(): void {
  eventRequests.clear();
  sceneCache.clear();
  lastRoomRequestAt = 0;
}
