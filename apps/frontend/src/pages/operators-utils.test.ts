import { describe, expect, it } from "vitest";
import { filterOperators } from "./operators-utils";

type User = { operatorId: number };

const users: User[] = [
  { operatorId: 1 },
  { operatorId: 2 },
  { operatorId: 3 },
  { operatorId: 4 },
];

describe("filterOperators", () => {
  it("returns all users when no filters are selected", () => {
    const result = filterOperators({
      users,
      selectedQueueId: null,
      selectedGroupId: null,
      queueUsersById: new Map(),
      groupUsersById: new Map(),
    });

    expect(result.map((item) => item.operatorId)).toEqual([1, 2, 3, 4]);
  });

  it("filters by queue only", () => {
    const result = filterOperators({
      users,
      selectedQueueId: 10,
      selectedGroupId: null,
      queueUsersById: new Map([[10, new Set([1, 3, 4])]]),
      groupUsersById: new Map(),
    });

    expect(result.map((item) => item.operatorId)).toEqual([1, 3, 4]);
  });

  it("filters by group only", () => {
    const result = filterOperators({
      users,
      selectedQueueId: null,
      selectedGroupId: 20,
      queueUsersById: new Map(),
      groupUsersById: new Map([[20, new Set([2, 3])]]),
    });

    expect(result.map((item) => item.operatorId)).toEqual([2, 3]);
  });

  it("returns queue and group intersection", () => {
    const result = filterOperators({
      users,
      selectedQueueId: 10,
      selectedGroupId: 20,
      queueUsersById: new Map([[10, new Set([1, 2, 3])]]),
      groupUsersById: new Map([[20, new Set([2, 4])]]),
    });

    expect(result.map((item) => item.operatorId)).toEqual([2]);
  });

  it("returns empty when one side is empty", () => {
    const result = filterOperators({
      users,
      selectedQueueId: 10,
      selectedGroupId: 20,
      queueUsersById: new Map([[10, new Set([1, 2, 3])]]),
      groupUsersById: new Map([[20, new Set()]]),
    });

    expect(result).toEqual([]);
  });
});
