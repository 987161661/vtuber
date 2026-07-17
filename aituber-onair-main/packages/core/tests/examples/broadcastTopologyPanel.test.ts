import { describe, expect, it } from 'vitest';
import {
  isCurrentBroadcastFault,
  isProductionEvent,
  routeFor,
} from '../../examples/react-purupuru-app/src/components/BroadcastTopologyPanel';

describe('Soul-aware broadcast topology', () => {
  it('closes a fault detail after the runtime fault is cleared or replaced', () => {
    const reference = { nodeId: 'persona', at: 100, stage: 'soul_fast_fallback' };

    expect(
      isCurrentBroadcastFault(reference, {
        at: 100,
        stage: 'soul_fast_fallback',
      }),
    ).toBe(true);
    expect(isCurrentBroadcastFault(reference, undefined)).toBe(false);
    expect(
      isCurrentBroadcastFault(reference, {
        at: 200,
        stage: 'soul_fast_fallback',
      }),
    ).toBe(false);
  });

  it('keeps Soul runtime stages in the production event stream', () => {
    expect(
      isProductionEvent({
        eventId: 'event-1',
        stage: 'soul_shadow_decision',
        runtimeMode: 'shadow',
      }),
    ).toBe(true);
  });

  it.each([
    ['soul_shadow_decision', 'persona'],
    ['soul_decision_selected', 'persona'],
    ['soul_formal_silence', 'persona'],
    ['soul_speech_plan_built', 'queue'],
    ['soul_outcome_committed', 'playback'],
    ['soul_delivered_projection_committed', 'playback'],
  ] as const)('maps %s to the %s causal node', (stage, node) => {
    expect(routeFor({ eventId: 'event-1', stage }).node).toBe(node);
  });

  it('continues to show legacy persona planning during shadow migration', () => {
    expect(
      routeFor({ eventId: 'event-1', stage: 'persona_plan_completed' }),
    ).toMatchObject({ node: 'persona', activeEdges: ['persona-model'] });
  });
});
