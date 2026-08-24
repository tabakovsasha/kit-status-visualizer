export type QueueCatalogItem = {
  id: string;
  queueId: number;
  queueTitle: string;
  payload: {
    users?: Array<{
      id: number;
    }>;
  };
};

export type QueueMemberships = Map<number, Set<number>>;

export function buildQueueMemberships(
  queues: QueueCatalogItem[],
): QueueMemberships {
  const memberships = new Map<number, Set<number>>();

  for (const queue of queues) {
    memberships.set(
      queue.queueId,
      new Set((queue.payload.users ?? []).map((user) => user.id)),
    );
  }

  return memberships;
}

export function getOperatorsByQueue<T extends { operatorId: number }>(input: {
  operators: T[];
  queueId: number | null;
  queueMemberships: QueueMemberships;
}): T[] {
  const { operators, queueId, queueMemberships } = input;

  if (queueId === null) {
    return operators;
  }

  const queueUsers = queueMemberships.get(queueId) ?? new Set<number>();
  return operators.filter((operator) => queueUsers.has(operator.operatorId));
}

export function getSelectedVisibleOperators<
  T extends { operatorId: number },
>(input: { filteredOperators: T[]; selectedOperatorIds: number[] }): T[] {
  const selected = new Set(input.selectedOperatorIds);
  return input.filteredOperators.filter((operator) =>
    selected.has(operator.operatorId),
  );
}

export function getSelectedVisibleOperatorIds<
  T extends { operatorId: number },
>(input: { filteredOperators: T[]; selectedOperatorIds: number[] }): number[] {
  return getSelectedVisibleOperators(input).map(
    (operator) => operator.operatorId,
  );
}

export function deriveQueueSelection(input: {
  savedQueueId: number | null;
  selectedOperatorIds: number[];
  queueMemberships: QueueMemberships;
}): number | null {
  const { savedQueueId, selectedOperatorIds, queueMemberships } = input;

  if (savedQueueId !== null) {
    const queueUsers = queueMemberships.get(savedQueueId);
    if (
      queueUsers &&
      selectedOperatorIds.every((operatorId) => queueUsers.has(operatorId))
    ) {
      return savedQueueId;
    }
  }

  if (selectedOperatorIds.length === 0) {
    return null;
  }

  const queueMatches = new Set<number>();
  for (const [queueId, queueUsers] of queueMemberships.entries()) {
    if (selectedOperatorIds.every((operatorId) => queueUsers.has(operatorId))) {
      queueMatches.add(queueId);
    }
  }

  return queueMatches.size === 1 ? [...queueMatches][0] : null;
}
