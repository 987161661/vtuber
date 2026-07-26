type IdentifiedAction = {
  actionId: string;
};

const DEFAULT_ACKNOWLEDGEMENT_LIMIT = 512;

export function filterUnacknowledgedActions<T extends IdentifiedAction>(
  actions: readonly T[],
  acknowledgedActionIds: ReadonlySet<string>,
): T[] {
  return actions.filter(
    (action) => !acknowledgedActionIds.has(action.actionId),
  );
}

export function rememberAcknowledgedActions(
  acknowledgedActionIds: Set<string>,
  actionIds: readonly string[],
  limit = DEFAULT_ACKNOWLEDGEMENT_LIMIT,
): void {
  for (const actionId of actionIds) {
    acknowledgedActionIds.delete(actionId);
    acknowledgedActionIds.add(actionId);
  }
  while (acknowledgedActionIds.size > limit) {
    const oldest = acknowledgedActionIds.values().next().value;
    if (typeof oldest !== 'string') break;
    acknowledgedActionIds.delete(oldest);
  }
}
