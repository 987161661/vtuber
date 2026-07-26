import { describe, expect, it } from 'vitest';
import {
  filterUnacknowledgedActions,
  rememberAcknowledgedActions,
} from '../../examples/react-purupuru-app/src/lib/liveHostActionAcknowledgement';

describe('live host action acknowledgement', () => {
  it('does not admit the same deferred action after it was acknowledged', () => {
    const acknowledged = new Set<string>();
    const action = { actionId: 'scope:event:failed:operator-attention:0' };

    expect(filterUnacknowledgedActions([action], acknowledged)).toEqual([
      action,
    ]);

    rememberAcknowledgedActions(acknowledged, [action.actionId]);

    expect(filterUnacknowledgedActions([action], acknowledged)).toEqual([]);
  });

  it('bounds remembered action ids while retaining the newest acknowledgements', () => {
    const acknowledged = new Set<string>(['old-1', 'old-2']);

    rememberAcknowledgedActions(acknowledged, ['new-1', 'new-2'], 3);

    expect([...acknowledged]).toEqual(['old-2', 'new-1', 'new-2']);
  });
});
