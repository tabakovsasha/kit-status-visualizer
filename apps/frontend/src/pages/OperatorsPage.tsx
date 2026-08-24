import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../state/auth";
import { apiRequest, getApiErrorMessage } from "../lib/api";
import {
  filterOperators,
  toCalendarDate,
  toClockTime,
  uniqNumbers,
} from "./operators-utils";

type QueueSnapshot = {
  id: string;
  queueId: number;
  queueTitle: string;
  payload: {
    id?: number;
    acd_queue_title?: string;
    users?: Array<{
      id: number;
      username?: string;
      full_name?: string | null;
      call_status?: string;
      call_status_change_time?: string;
      profile?: { utc?: string | null } | null;
      group_id?: number | null;
      skills?: Array<{ skill_name?: string }>;
    }>;
  };
  refreshedAt: string;
};

type GroupSnapshot = {
  id: string;
  groupId: number;
  groupTitle: string;
  payload: { id?: number; group_title?: string };
  refreshedAt: string;
};

type OperatorSnapshot = {
  id: string;
  operatorId: number;
  fullName?: string | null;
  timezone?: string | null;
  payload: {
    id: number;
    username?: string;
    full_name?: string | null;
    call_status?: string;
    call_status_change_time?: string;
    profile?: { utc?: string | null } | null;
    group_id?: number | null;
    skills?: Array<{ skill_name?: string }>;
  };
  refreshedAt: string;
};

type StatusTypeSnapshot = {
  id: string;
  statusKey: string;
  title: string;
  color?: string | null;
  description?: string | null;
};

type SavedSelection = {
  id: string;
  name: string;
  items: Array<{ operatorId: number }>;
};

type PageState = {
  selectedQueueId?: number | null;
  selectedGroupId?: number | null;
  search?: string;
  selectedOperatorIds?: number[];
  lastUpdatedAt?: string | null;
};

type SelectionPayload = {
  name: string;
  operatorIds: number[];
};

type Preferences = {
  operatorsPageState?: PageState;
};

function formatDateTime(value?: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatTimezoneLabel(timeZone?: string | null) {
  if (!timeZone) return "Часовой пояс не указан";
  const date = new Date("2026-07-20T12:00:00.000Z");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "shortOffset",
  }).formatToParts(date);
  const offset =
    parts.find((part) => part.type === "timeZoneName")?.value ?? "";
  return offset ? `${timeZone} — ${offset}` : timeZone;
}

function statusColor(statusTypes: StatusTypeSnapshot[], status?: string) {
  if (!status) return "#A1A1AA";
  const found = statusTypes.find((item) => item.statusKey === status);
  if (found?.color && /^([0-9A-Fa-f]{6})$/.test(found.color)) {
    return `#${found.color}`;
  }
  const seed = Array.from(status).reduce(
    (acc, char) => acc + char.charCodeAt(0),
    0,
  );
  const palette = [
    "#5FCDE5",
    "#7ACC90",
    "#367BF5",
    "#7C4DFF",
    "#F3AA18",
    "#EA7E75",
    "#78909C",
  ];
  return palette[seed % palette.length];
}

function statusTitle(statusTypes: StatusTypeSnapshot[], status?: string) {
  if (!status) return "—";
  return statusTypes.find((item) => item.statusKey === status)?.title ?? status;
}

function shortCount(value: number) {
  return new Intl.NumberFormat("ru-RU").format(value);
}

export function OperatorsPage() {
  const navigate = useNavigate();
  const accessToken = useAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
  const [searchText, setSearchText] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState<number | "all">("all");
  const [selectedQueueId, setSelectedQueueId] = useState<number | "all">("all");
  const [selectedOperatorIds, setSelectedOperatorIds] = useState<number[]>([]);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const initRef = useRef(false);
  const visibleCheckboxRef = useRef<HTMLInputElement | null>(null);
  const saveSelectionName = "Timeline selection";

  const preferencesQuery = useQuery({
    queryKey: ["preferences"],
    queryFn: () =>
      apiRequest<Preferences>("/preferences", {
        accessToken: accessToken ?? undefined,
      }),
    enabled: !!accessToken,
    staleTime: 60_000,
  });

  const queuesQuery = useQuery({
    queryKey: ["catalog-queues"],
    queryFn: () =>
      apiRequest<QueueSnapshot[]>("/catalog/queues", {
        accessToken: accessToken ?? undefined,
      }),
    enabled: !!accessToken,
    staleTime: 5 * 60_000,
  });

  const groupsQuery = useQuery({
    queryKey: ["catalog-groups"],
    queryFn: () =>
      apiRequest<GroupSnapshot[]>("/catalog/groups", {
        accessToken: accessToken ?? undefined,
      }),
    enabled: !!accessToken,
    staleTime: 5 * 60_000,
  });

  const operatorsQuery = useQuery({
    queryKey: ["catalog-operators"],
    queryFn: () =>
      apiRequest<OperatorSnapshot[]>("/catalog/operators", {
        accessToken: accessToken ?? undefined,
      }),
    enabled: !!accessToken,
    staleTime: 5 * 60_000,
  });

  const statusTypesQuery = useQuery({
    queryKey: ["catalog-status-types"],
    queryFn: () =>
      apiRequest<StatusTypeSnapshot[]>("/catalog/status-types", {
        accessToken: accessToken ?? undefined,
      }),
    enabled: !!accessToken,
    staleTime: 5 * 60_000,
  });

  const selectionsQuery = useQuery({
    queryKey: ["operator-selections"],
    queryFn: () =>
      apiRequest<SavedSelection[]>("/operator-selections", {
        accessToken: accessToken ?? undefined,
      }),
    enabled: !!accessToken,
    staleTime: 60_000,
  });

  const refreshMutation = useMutation({
    mutationFn: () =>
      apiRequest<{
        refreshedAt: string;
        counts: {
          users: number;
          groups: number;
          queues: number;
          statusTypes: number;
        };
      }>("/catalog/refresh", {
        method: "POST",
        accessToken: accessToken ?? undefined,
      }),
    onSuccess: async (value) => {
      setLastUpdatedAt(value.refreshedAt);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["catalog-queues"] }),
        queryClient.invalidateQueries({ queryKey: ["catalog-groups"] }),
        queryClient.invalidateQueries({ queryKey: ["catalog-operators"] }),
        queryClient.invalidateQueries({ queryKey: ["catalog-status-types"] }),
      ]);
    },
  });

  const selectionMutation = useMutation({
    mutationFn: async (payload: SelectionPayload) => {
      const existing = selectionsQuery.data?.find(
        (item) => item.name === saveSelectionName,
      );
      if (existing) {
        return apiRequest<SavedSelection>(
          `/operator-selections/${existing.id}`,
          {
            method: "PUT",
            accessToken: accessToken ?? undefined,
            body: JSON.stringify(payload),
          },
        );
      }
      return apiRequest<SavedSelection>("/operator-selections", {
        method: "POST",
        accessToken: accessToken ?? undefined,
        body: JSON.stringify(payload),
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["operator-selections"],
      });
      await persistPreferences();
    },
  });

  const preferenceMutation = useMutation({
    mutationFn: (payload: Preferences) =>
      apiRequest<Preferences>("/preferences", {
        method: "PUT",
        accessToken: accessToken ?? undefined,
        body: JSON.stringify(payload),
      }),
  });

  const operatorById = useMemo(() => {
    const map = new Map<number, OperatorSnapshot>();
    for (const operator of operatorsQuery.data ?? []) {
      map.set(operator.operatorId, operator);
    }
    return map;
  }, [operatorsQuery.data]);

  const groupById = useMemo(() => {
    const map = new Map<number, GroupSnapshot>();
    for (const group of groupsQuery.data ?? []) {
      map.set(group.groupId, group);
    }
    return map;
  }, [groupsQuery.data]);

  const statusTypes = statusTypesQuery.data ?? [];

  const defaultSelectionIds = useMemo(() => {
    const saved = selectionsQuery.data?.find(
      (item) => item.name === saveSelectionName,
    );
    return saved ? uniqNumbers(saved.items.map((item) => item.operatorId)) : [];
  }, [selectionsQuery.data]);

  useEffect(() => {
    if (initRef.current) return;
    if (
      !queuesQuery.data ||
      !operatorsQuery.data ||
      !groupsQuery.data ||
      !selectionsQuery.data ||
      !preferencesQuery.data
    ) {
      return;
    }

    const savedState = preferencesQuery.data.operatorsPageState;
    setSelectedQueueId(savedState?.selectedQueueId ?? "all");
    setSelectedGroupId(savedState?.selectedGroupId ?? "all");
    setSearchText(savedState?.search ?? "");
    setSelectedOperatorIds(
      uniqNumbers(
        savedState?.selectedOperatorIds?.length
          ? savedState.selectedOperatorIds
          : defaultSelectionIds,
      ),
    );
    setLastUpdatedAt(
      savedState?.lastUpdatedAt ??
        queuesQuery.data[0]?.refreshedAt ??
        operatorsQuery.data[0]?.refreshedAt ??
        null,
    );
    initRef.current = true;
    setInitialized(true);
  }, [
    queuesQuery.data,
    operatorsQuery.data,
    groupsQuery.data,
    selectionsQuery.data,
    preferencesQuery.data,
    defaultSelectionIds,
  ]);

  const persistPreferences = async () => {
    if (!accessToken) return;
    await preferenceMutation.mutateAsync({
      operatorsPageState: {
        selectedQueueId: selectedQueueId === "all" ? null : selectedQueueId,
        selectedGroupId: selectedGroupId === "all" ? null : selectedGroupId,
        search: searchText,
        selectedOperatorIds,
        lastUpdatedAt,
      },
    });
  };

  useEffect(() => {
    if (!initialized || !accessToken) return;
    const timer = window.setTimeout(() => {
      preferenceMutation.mutate({
        operatorsPageState: {
          selectedQueueId: selectedQueueId === "all" ? null : selectedQueueId,
          selectedGroupId: selectedGroupId === "all" ? null : selectedGroupId,
          search: searchText,
          selectedOperatorIds,
          lastUpdatedAt,
        },
      });
    }, 350);

    return () => window.clearTimeout(timer);
  }, [
    selectedQueueId,
    selectedGroupId,
    searchText,
    selectedOperatorIds,
    lastUpdatedAt,
    initialized,
    accessToken,
    preferenceMutation,
  ]);

  const queueUsersById = useMemo(() => {
    const map = new Map<number, Set<number>>();
    for (const queue of queuesQuery.data ?? []) {
      map.set(
        queue.queueId,
        new Set((queue.payload.users ?? []).map((item) => item.id)),
      );
    }
    return map;
  }, [queuesQuery.data]);

  const queuesByOperatorId = useMemo(() => {
    const map = new Map<number, string[]>();
    for (const queue of queuesQuery.data ?? []) {
      const title = queue.queueTitle?.trim() || `Очередь #${queue.queueId}`;
      for (const user of queue.payload.users ?? []) {
        const current = map.get(user.id) ?? [];
        if (!current.includes(title)) {
          current.push(title);
        }
        map.set(user.id, current);
      }
    }
    return map;
  }, [queuesQuery.data]);

  const groupUsersById = useMemo(() => {
    const map = new Map<number, Set<number>>();
    for (const operator of operatorsQuery.data ?? []) {
      const id = operator.payload.group_id;
      if (!id) {
        continue;
      }
      if (!map.has(id)) {
        map.set(id, new Set());
      }
      map.get(id)?.add(operator.operatorId);
    }
    return map;
  }, [operatorsQuery.data]);

  const operatorRows = useMemo(() => {
    return (operatorsQuery.data ?? [])
      .map((operator) => {
        const fallback = operatorById.get(operator.operatorId)?.payload;
        const timezone =
          operator.timezone ?? operator.payload.profile?.utc ?? null;
        const groupIdValue = operator.payload.group_id ?? null;
        const groupTitle = groupIdValue
          ? (groupById.get(groupIdValue)?.groupTitle ??
            `Группа #${groupIdValue}`)
          : "Без группы";
        const fullName =
          operator.fullName?.trim() ||
          operator.payload.full_name?.trim() ||
          operator.payload.username ||
          `Оператор #${operator.operatorId}`;
        const queueTitles = queuesByOperatorId.get(operator.operatorId) ?? [];

        return {
          id: operator.operatorId,
          operatorId: operator.operatorId,
          fullName,
          callStatus:
            operator.payload.call_status ?? fallback?.call_status ?? "UNKNOWN",
          callStatusChangeTime:
            operator.payload.call_status_change_time ??
            fallback?.call_status_change_time ??
            null,
          timezone,
          groupId: groupIdValue,
          groupTitle,
          skills: operator.payload.skills ?? fallback?.skills ?? [],
          queueTitles,
        };
      })
      .sort((a, b) => a.fullName.localeCompare(b.fullName, "ru"));
  }, [operatorsQuery.data, operatorById, groupById, queuesByOperatorId]);

  const filteredBySelectors = useMemo(
    () =>
      filterOperators({
        users: operatorRows,
        selectedQueueId: selectedQueueId === "all" ? null : selectedQueueId,
        selectedGroupId: selectedGroupId === "all" ? null : selectedGroupId,
        queueUsersById,
        groupUsersById,
      }),
    [
      operatorRows,
      selectedQueueId,
      selectedGroupId,
      queueUsersById,
      groupUsersById,
    ],
  );

  const filteredRows = useMemo(() => {
    const search = searchText.trim().toLowerCase();
    if (!search) {
      return filteredBySelectors;
    }

    return filteredBySelectors.filter((row) => {
      const queueText = row.queueTitles.join(" ").toLowerCase();
      return (
        row.fullName.toLowerCase().includes(search) ||
        String(row.id).includes(search) ||
        row.groupTitle.toLowerCase().includes(search) ||
        (row.timezone ?? "").toLowerCase().includes(search) ||
        queueText.includes(search)
      );
    });
  }, [filteredBySelectors, searchText]);

  const visibleOperatorIds = useMemo(
    () => uniqNumbers(filteredRows.map((row) => row.id)),
    [filteredRows],
  );

  const selectedCount = selectedOperatorIds.length;
  const hasVisibleOperators = visibleOperatorIds.length > 0;
  const selectedVisibleCount = visibleOperatorIds.filter((id) =>
    selectedOperatorIds.includes(id),
  ).length;
  const allVisibleSelected =
    hasVisibleOperators && selectedVisibleCount === visibleOperatorIds.length;
  const someVisibleSelected = selectedVisibleCount > 0 && !allVisibleSelected;
  const updatedLabel = lastUpdatedAt
    ? formatDateTime(lastUpdatedAt)
    : "Пока не обновлялись";

  useEffect(() => {
    if (!visibleCheckboxRef.current) {
      return;
    }
    visibleCheckboxRef.current.indeterminate = someVisibleSelected;
  }, [someVisibleSelected]);

  const toggleOperator = (operatorId: number, checked: boolean) => {
    setSelectedOperatorIds((current) => {
      const next = checked
        ? uniqNumbers([...current, operatorId])
        : current.filter((value) => value !== operatorId);
      return next;
    });
  };

  const toggleVisibleSelection = (checked: boolean) => {
    if (checked) {
      setSelectedOperatorIds((current) =>
        uniqNumbers([...current, ...visibleOperatorIds]),
      );
      return;
    }

    const visible = new Set(visibleOperatorIds);
    setSelectedOperatorIds((current) =>
      current.filter((id) => !visible.has(id)),
    );
  };

  const selectVisible = () => {
    toggleVisibleSelection(true);
  };

  const clearVisible = () => {
    toggleVisibleSelection(false);
  };

  const saveSelection = async () => {
    await selectionMutation.mutateAsync({
      name: saveSelectionName,
      operatorIds: selectedOperatorIds,
    });
  };

  const visualizeStatuses = async () => {
    await saveSelection();
    navigate("/timeline");
  };

  const updateSelectionFromDefault = () => {
    if (defaultSelectionIds.length > 0) {
      setSelectedOperatorIds(defaultSelectionIds);
    }
  };

  const selectedGroupOptions = useMemo(
    () =>
      (groupsQuery.data ?? []).map((group) => ({
        ...group,
        usersCount:
          operatorsQuery.data?.filter(
            (item) => item.payload.group_id === group.groupId,
          ).length ?? 0,
      })),
    [groupsQuery.data, operatorsQuery.data],
  );

  const selectedQueueOptions = useMemo(
    () =>
      (queuesQuery.data ?? []).map((queue) => ({
        queueId: queue.queueId,
        queueTitle: queue.queueTitle,
        usersCount: queue.payload.users?.length ?? 0,
      })),
    [queuesQuery.data],
  );

  return (
    <section className="page-grid">
      <div className="page-header">
        <div className="section-kicker">Операторы</div>
        <h1>Выберите очередь и операторов для таймлайна</h1>
        <p>
          Фильтры Очередь и Группа работают совместно: в таблице показываются
          только операторы из их пересечения.
        </p>
      </div>

      <section className="card panel">
        <div className="panel-head">
          <div>
            <h2>Управление данными</h2>
            <p>Данные обновлены: {updatedLabel}</p>
          </div>
          <div className="form-actions">
            <button
              className="button button-secondary"
              type="button"
              onClick={updateSelectionFromDefault}
              disabled={!defaultSelectionIds.length}
            >
              Вернуть сохранённый выбор
            </button>
            <button
              className="button button-primary"
              type="button"
              onClick={() => refreshMutation.mutate()}
              disabled={refreshMutation.isPending || !accessToken}
            >
              {refreshMutation.isPending
                ? "Обновляем очереди и операторов…"
                : "Обновить данные"}
            </button>
          </div>
        </div>

        <div className="operator-toolbar">
          <div className="field-grid field-grid-two">
            <label className="field">
              <span>Поиск по операторам</span>
              <input
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="Например: Карина, 1219, Europe/Moscow"
              />
            </label>
            <label className="field">
              <span>Очередь</span>
              <select
                value={selectedQueueId}
                onChange={(event) =>
                  setSelectedQueueId(
                    event.target.value === "all"
                      ? "all"
                      : Number(event.target.value),
                  )
                }
              >
                <option value="all">Все очереди</option>
                {selectedQueueOptions.map((queue) => (
                  <option key={queue.queueId} value={queue.queueId}>
                    {queue.queueTitle}{" "}
                    {queue.usersCount ? `(${queue.usersCount})` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Группа</span>
              <select
                value={selectedGroupId}
                onChange={(event) =>
                  setSelectedGroupId(
                    event.target.value === "all"
                      ? "all"
                      : Number(event.target.value),
                  )
                }
              >
                <option value="all">Все группы</option>
                {selectedGroupOptions.map((group) => (
                  <option key={group.groupId} value={group.groupId}>
                    {group.groupTitle}{" "}
                    {group.usersCount ? `(${group.usersCount})` : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="form-actions">
            <button
              className="button button-secondary"
              type="button"
              onClick={selectVisible}
              disabled={!hasVisibleOperators}
            >
              Выбрать всех видимых
            </button>
            <button
              className="button button-secondary"
              type="button"
              onClick={clearVisible}
              disabled={!selectedCount}
            >
              Снять выбор у видимых
            </button>
            <button
              className="button button-primary"
              type="button"
              onClick={saveSelection}
              disabled={selectionMutation.isPending || !selectedCount}
            >
              {selectionMutation.isPending ? "Сохранение…" : "Сохранить выбор"}
            </button>
            <button
              className="button button-primary"
              type="button"
              onClick={visualizeStatuses}
              disabled={selectionMutation.isPending || selectedCount === 0}
            >
              Визуализировать статусы
            </button>
          </div>

          <div className="row-between">
            <span className="muted">Выбрано: {selectedCount}</span>
            <span className="muted">
              Видимых после фильтров: {filteredRows.length}
            </span>
          </div>

          {selectionMutation.isSuccess && (
            <div className="success-banner">Выбор сохранён</div>
          )}
          {refreshMutation.isSuccess && (
            <div className="success-banner">
              Данные очередей и операторов обновлены.
            </div>
          )}
          {(preferencesQuery.isError ||
            queuesQuery.isError ||
            groupsQuery.isError ||
            operatorsQuery.isError ||
            statusTypesQuery.isError) && (
            <div className="error-banner">
              {getApiErrorMessage(
                preferencesQuery.error ??
                  queuesQuery.error ??
                  groupsQuery.error ??
                  operatorsQuery.error ??
                  statusTypesQuery.error,
              )}
            </div>
          )}
        </div>
      </section>

      <section className="layout-minimal">
        {filteredRows.length === 0 && !operatorsQuery.isLoading && (
          <div className="empty-state">
            <strong>Нет операторов по выбранным фильтрам</strong>
            <p>
              Измените фильтры Очередь/Группа или очистите поисковую строку.
            </p>
          </div>
        )}

        {filteredRows.length > 0 && (
          <article className="card panel">
            <div className="queue-table-wrap">
              <table
                className="queue-table"
                data-testid="operators-unified-table"
              >
                <thead>
                  <tr>
                    <th style={{ width: 56 }}>
                      <input
                        ref={visibleCheckboxRef}
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={(event) =>
                          toggleVisibleSelection(event.target.checked)
                        }
                        aria-label="Выбрать всех видимых операторов"
                      />
                    </th>
                    <th>Оператор</th>
                    <th>Текущий статус</th>
                    <th>Время изменения статуса</th>
                    <th>Часовой пояс</th>
                    <th>Группа</th>
                    <th>Очереди</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((operator) => {
                    const status = operator.callStatus;
                    const color = statusColor(statusTypes, status);
                    const statusName = statusTitle(statusTypes, status);
                    const isSelected = selectedOperatorIds.includes(
                      operator.id,
                    );
                    const fallbackTimezone = !operator.timezone;
                    const timezoneLabel = operator.timezone
                      ? formatTimezoneLabel(operator.timezone)
                      : "Часовой пояс не указан · fallback UTC";

                    return (
                      <tr
                        key={operator.id}
                        className={isSelected ? "row-selected" : ""}
                      >
                        <td>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={(event) =>
                              toggleOperator(operator.id, event.target.checked)
                            }
                            aria-label={`Выбрать ${operator.fullName}`}
                          />
                        </td>
                        <td>
                          <div className="operator-cell">
                            <strong>{operator.fullName}</strong>
                            <span className="muted mono">
                              ID: {operator.id}
                            </span>
                          </div>
                        </td>
                        <td>
                          <div className="status-cell">
                            <span
                              className="status-dot"
                              style={{ background: color }}
                            />
                            <span
                              className="status-pill"
                              style={{ borderColor: color, color }}
                            >
                              {statusName}
                            </span>
                          </div>
                        </td>
                        <td>
                          <div className="operator-cell">
                            <strong>
                              {toClockTime(
                                operator.callStatusChangeTime,
                                operator.timezone ?? "UTC",
                              )}
                            </strong>
                            <span
                              className={`muted ${fallbackTimezone ? "fallback-note" : ""}`}
                            >
                              {toCalendarDate(operator.callStatusChangeTime)}
                            </span>
                          </div>
                        </td>
                        <td>
                          <div className="operator-cell">
                            <strong>{operator.timezone ?? "UTC"}</strong>
                            <span className="muted">{timezoneLabel}</span>
                          </div>
                        </td>
                        <td>
                          <div className="operator-cell">
                            <strong>{operator.groupTitle}</strong>
                            <span className="muted">
                              {operator.skills.length > 0
                                ? operator.skills
                                    .map((skill) => skill.skill_name)
                                    .filter(Boolean)
                                    .join(", ")
                                : "—"}
                            </span>
                          </div>
                        </td>
                        <td>
                          <div className="operator-cell">
                            <strong>
                              {shortCount(operator.queueTitles.length)}
                            </strong>
                            <span className="muted">
                              {operator.queueTitles.length
                                ? operator.queueTitles.join(", ")
                                : "Не добавлен в очереди"}
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </article>
        )}
      </section>
    </section>
  );
}
