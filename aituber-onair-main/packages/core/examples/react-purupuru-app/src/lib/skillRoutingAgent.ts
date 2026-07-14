import type { RecentLiveTurn, SkillRoutingDecision } from './liveConversationContext';

export async function routeTyphoonSkillWithAgent(input: {
  text: string;
  viewerId?: string;
  viewerName?: string;
  sourceLabel?: string;
  turns: RecentLiveTurn[];
}): Promise<SkillRoutingDecision> {
  try {
    const response = await fetch('/api/skill-route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: input.text,
        speaker: { id: input.viewerId, name: input.viewerName, source: input.sourceLabel },
        turns: input.turns.slice(-16),
      }),
    });
    if (!response.ok) throw new Error(`skill_router_http_${response.status}`);
    const data = await response.json() as Partial<SkillRoutingDecision>;
    return {
      inheritTyphoon: data.inheritTyphoon === true,
      reason: typeof data.reason === 'string' ? data.reason.slice(0, 100) : 'agent_route',
    };
  } catch {
    // A router failure must never turn normal conversation into a weather
    // fallback. The main agent can still answer using the room transcript.
    return { inheritTyphoon: false, reason: 'router_unavailable_no_skill' };
  }
}
