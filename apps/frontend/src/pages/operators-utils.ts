export type FilterableOperator = {
  operatorId: number;
};

export type FilterOperatorsInput<T extends FilterableOperator> = {
  users: T[];
  selectedQueueId: number | null;
  selectedGroupId: number | null;
  queueUsersById: Map<number, Set<number>>;
  groupUsersById: Map<number, Set<number>>;
};

export function filterOperators<T extends FilterableOperator>(
  input: FilterOperatorsInput<T>,
): T[] {
  const {
    users,
    selectedQueueId,
    selectedGroupId,
    queueUsersById,
    groupUsersById,
  } = input;

  if (selectedQueueId === null && selectedGroupId === null) {
    return users;
  }

  const queueUsers =
    selectedQueueId !== null
      ? (queueUsersById.get(selectedQueueId) ?? new Set<number>())
      : null;
  const groupUsers =
    selectedGroupId !== null
      ? (groupUsersById.get(selectedGroupId) ?? new Set<number>())
      : null;

  return users.filter((user) => {
    const inQueue = queueUsers ? queueUsers.has(user.operatorId) : true;
    const inGroup = groupUsers ? groupUsers.has(user.operatorId) : true;
    return inQueue && inGroup;
  });
}

export function toClockTime(
  value?: string | null,
  timezone?: string | null,
): string {
  if (!value) return "—";
  const iso = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: timezone ?? "UTC",
  }).format(new Date(iso));
}

export function toCalendarDate(value?: string | null): string {
  if (!value) return "—";
  const iso = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(iso));
}

export function uniqNumbers(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}
