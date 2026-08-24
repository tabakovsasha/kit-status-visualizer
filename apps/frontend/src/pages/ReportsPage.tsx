import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type MouseEvent,
} from "react";
import { apiRequest, getApiErrorMessage } from "../lib/api";
import { useAuthStore } from "../state/auth";
import { useReportStore } from "../state/report";
import {
  buildQueueMemberships,
  type QueueCatalogItem,
} from "./timeline-selection-utils";
import {
  OperatorStatusSummary,
  type StatusConfig,
  type StatusInterval,
} from "./OperatorStatusSummary";
import {
  buildUtcWindowIso,
  computeAxisTicksForTimezone,
  computeTrackSegments,
  fallbackStatusColor,
  formatLocalTimeFromMs,
  normalizeStatusColor,
  type TimelineSegmentPresentation,
  type TimelineTrackSegment,
} from "./timeline-utils";

type OperatorTimelineResult = {
  operatorId: number;
  ok: boolean;
  error?: string;
  presentation?: TimelineSegmentPresentation[];
};

type TimelineQueryResponse = {
  from: string;
  to: string;
  timezone: string;
  operators: OperatorTimelineResult[];
};

type OperatorCatalogItem = {
  id: string;
  operatorId: number;
  fullName?: string | null;
  timezone?: string | null;
  payload?: {
    group_id?: number | null;
    call_status?: string;
    call_status_change_time?: string;
  };
};

type QueueSnapshot = QueueCatalogItem & {
  payload: {
    users?: Array<{ id: number }>;
  };
};

type GroupSnapshot = {
  id: string;
  groupId: number;
  groupTitle: string;
};

type StatusTypeSnapshot = {
  statusKey: string;
  title: string;
  color?: string | null;
  description?: string | null;
};

type CredentialsState = {
  tokenConfigured: boolean;
};

type CatalogRefreshResponse = {
  refreshedAt: string;
  counts: {
    users: number;
    groups: number;
    queues: number;
    statusTypes: number;
  };
};

type TooltipState = {
  segmentKey: string;
  x: number;
  y: number;
  segment: TimelineTrackSegment;
};

const DEFAULT_TIMEZONE = "Europe/Moscow";

function todayIsoLocal(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function formatIsoDateToDisplay(value: string): string {
  if (!ISO_DATE_RE.test(value)) {
    return "";
  }
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function normalizeDateInput(value: string): string {
  const digitsOnly = value.replace(/\D/g, "").slice(0, 8);
  const day = digitsOnly.slice(0, 2);
  const month = digitsOnly.slice(2, 4);
  const year = digitsOnly.slice(4, 8);

  if (digitsOnly.length <= 2) {
    return day;
  }
  if (digitsOnly.length <= 4) {
    return `${day}/${month}`;
  }
  return `${day}/${month}/${year}`;
}

function parseDisplayDateToIso(value: string): { iso: string | null; error: string | null } {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { iso: null, error: "Введите дату в формате ДД/ММ/ГГГГ." };
  }

  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed);
  if (!match) {
    return { iso: null, error: "Используйте формат ДД/ММ/ГГГГ." };
  }

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);

  if (month < 1 || month > 12) {
    return { iso: null, error: "Месяц должен быть в диапазоне 01-12." };
  }

  const daysInMonth = new Date(year, month, 0).getDate();
  if (day < 1 || day > daysInMonth) {
    return { iso: null, error: "Укажите корректный день для выбранного месяца." };
  }

  const iso = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  if (!ISO_DATE_RE.test(iso)) {
    return { iso: null, error: "Не удалось распознать дату." };
  }

  return { iso, error: null };
}

function formatDuration(seconds: number): string {
  const value = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const secs = value % 60;

  if (hours > 0) {
    return `${hours} ч ${minutes.toString().padStart(2, "0")} мин`;
  }
  if (minutes > 0) {
    return `${minutes} мин ${secs.toString().padStart(2, "0")} сек`;
  }

  return `${secs} сек`;
}

function statusTitle(statusTypes: StatusTypeSnapshot[], status: string): string {
  return statusTypes.find((item) => item.statusKey === status)?.title ?? status;
}

function statusColor(
  statusTypes: StatusTypeSnapshot[],
  status: string,
  isSystem?: boolean,
): string {
  if (isSystem && status === "NO_DATA") {
    return "#D5DAE5";
  }
  const found = statusTypes.find((item) => item.statusKey === status);
  const normalized = normalizeStatusColor(found?.color ?? null);
  return normalized ?? fallbackStatusColor(status);
}

function formatTimezoneBadge(timezone: string): string {
  const offset = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    timeZoneName: "shortOffset",
  })
    .formatToParts(new Date())
    .find((part) => part.type === "timeZoneName")?.value;
  return `${timezone} ${offset ?? "GMT+0"}`;
}

function formatStatusChangedAt(value: string | undefined, timezone: string): string {
  if (!value) {
    return "—";
  }

  const iso = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: timezone,
  }).format(parsed);
}

function toggleIdInArray(current: number[], id: number): number[] {
  if (current.includes(id)) {
    return current.filter((item) => item !== id);
  }
  return [...current, id].sort((a, b) => a - b);
}

export function ReportsPage() {
  const accessToken = useAuthStore((state) => state.accessToken);
  const queryClient = useQueryClient();

  const {
    selectedDate,
    workdayInterval,
    selectedGroupIds,
    selectedQueueIds,
    selectedOperatorIds,
    searchText,
    isFiltersCollapsed,
    isOperatorsCollapsed,
    timelineData,
    isTimelineBuilt,
    setSelectedDate,
    setWorkdayInterval,
    setSelectedGroupIds,
    setSelectedQueueIds,
    setSelectedOperatorIds,
    setSearchText,
    setIsFiltersCollapsed,
    setIsOperatorsCollapsed,
    setTimelineData,
    setIsTimelineBuilt,
  } = useReportStore();

  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [dateInput, setDateInput] = useState<string>(() =>
    formatIsoDateToDisplay(selectedDate),
  );
  const [dateInputError, setDateInputError] = useState<string | null>(null);
  const [expandedOperatorIds, setExpandedOperatorIds] = useState<Set<number>>(
    () => new Set(),
  );
  const [catalogRefreshAt, setCatalogRefreshAt] = useState<string | null>(null);
  const autoRefreshRef = useRef(false);
  const [timelineResult, setTimelineResult] =
    useState<TimelineQueryResponse | null>(
      isTimelineBuilt && timelineData
        ? (timelineData as TimelineQueryResponse)
        : null,
    );

  useEffect(() => {
    setSelectedDate(todayIsoLocal());
  }, [setSelectedDate]);

  useEffect(() => {
    setDateInput(formatIsoDateToDisplay(selectedDate));
  }, [selectedDate]);

  const operatorsQuery = useQuery({
    queryKey: ["report-operators"],
    queryFn: () =>
      apiRequest<OperatorCatalogItem[]>("/catalog/operators", {
        accessToken: accessToken ?? undefined,
      }),
    enabled: !!accessToken,
  });

  const queuesQuery = useQuery({
    queryKey: ["report-queues"],
    queryFn: () =>
      apiRequest<QueueSnapshot[]>("/catalog/queues", {
        accessToken: accessToken ?? undefined,
      }),
    enabled: !!accessToken,
    staleTime: 5 * 60_000,
  });

  const groupsQuery = useQuery({
    queryKey: ["report-groups"],
    queryFn: () =>
      apiRequest<GroupSnapshot[]>("/catalog/groups", {
        accessToken: accessToken ?? undefined,
      }),
    enabled: !!accessToken,
    staleTime: 5 * 60_000,
  });

  const statusTypesQuery = useQuery({
    queryKey: ["report-status-types"],
    queryFn: () =>
      apiRequest<StatusTypeSnapshot[]>("/catalog/status-types", {
        accessToken: accessToken ?? undefined,
      }),
    enabled: !!accessToken,
    staleTime: 12 * 60 * 60 * 1000,
  });

  const credentialsQuery = useQuery({
    queryKey: ["report-credentials"],
    queryFn: () =>
      apiRequest<CredentialsState>("/voximplant/credentials", {
        accessToken: accessToken ?? undefined,
      }),
    enabled: !!accessToken,
    staleTime: 60_000,
  });

  const refreshCatalogMutation = useMutation({
    mutationFn: () =>
      apiRequest<CatalogRefreshResponse>("/catalog/refresh", {
        method: "POST",
        accessToken: accessToken ?? undefined,
      }),
    onSuccess: async (value) => {
      setCatalogRefreshAt(value.refreshedAt);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["report-operators"] }),
        queryClient.invalidateQueries({ queryKey: ["report-queues"] }),
        queryClient.invalidateQueries({ queryKey: ["report-groups"] }),
        queryClient.invalidateQueries({ queryKey: ["report-status-types"] }),
      ]);
    },
  });

  const queueOptions = useMemo(() => queuesQuery.data ?? [], [queuesQuery.data]);
  const queueMemberships = useMemo(
    () => buildQueueMemberships(queueOptions),
    [queueOptions],
  );

  const activeTimezone = useMemo(() => {
    const operatorTimezone = (operatorsQuery.data ?? []).find(
      (operator) => !!operator.timezone,
    )?.timezone;

    return operatorTimezone || DEFAULT_TIMEZONE;
  }, [operatorsQuery.data]);

  const timezoneBadge = useMemo(
    () => formatTimezoneBadge(activeTimezone),
    [activeTimezone],
  );

  const operatorQueueTitles = useMemo(() => {
    const map = new Map<number, string[]>();

    for (const queue of queueOptions) {
      const title = queue.queueTitle || `Очередь #${queue.queueId}`;
      for (const user of queue.payload.users ?? []) {
        const list = map.get(user.id) ?? [];
        if (!list.includes(title)) {
          list.push(title);
        }
        map.set(user.id, list);
      }
    }

    return map;
  }, [queueOptions]);

  const groupTitleById = useMemo(() => {
    const map = new Map<number, string>();
    for (const group of groupsQuery.data ?? []) {
      map.set(group.groupId, group.groupTitle);
    }
    return map;
  }, [groupsQuery.data]);

  const filteredOperators = useMemo(() => {
    const all = operatorsQuery.data ?? [];
    const query = searchText.trim().toLowerCase();

    return all.filter((operator) => {
      const groupId = operator.payload?.group_id ?? null;

      const queuePass =
        selectedQueueIds.length === 0 ||
        selectedQueueIds.some((queueId) =>
          queueMemberships.get(queueId)?.has(operator.operatorId),
        );

      const groupPass =
        selectedGroupIds.length === 0 ||
        (groupId !== null && selectedGroupIds.includes(groupId));

      if (!queuePass || !groupPass) {
        return false;
      }

      if (!query) {
        return true;
      }

      const fullName = operator.fullName?.toLowerCase() ?? "";
      return (
        fullName.includes(query) || String(operator.operatorId).includes(query)
      );
    });
  }, [
    operatorsQuery.data,
    queueMemberships,
    searchText,
    selectedGroupIds,
    selectedQueueIds,
  ]);

  const selectedVisibleOperatorIds = useMemo(() => {
    const visible = new Set(filteredOperators.map((item) => item.operatorId));
    return selectedOperatorIds.filter((id) => visible.has(id));
  }, [filteredOperators, selectedOperatorIds]);

  const selectedVisibleOperators = useMemo(() => {
    const selected = new Set(selectedVisibleOperatorIds);
    return filteredOperators.filter((item) => selected.has(item.operatorId));
  }, [filteredOperators, selectedVisibleOperatorIds]);

  const timelineWindow = useMemo(
    () =>
      buildUtcWindowIso(
        selectedDate,
        workdayInterval.from,
        workdayInterval.to,
        activeTimezone,
      ),
    [selectedDate, workdayInterval.from, workdayInterval.to, activeTimezone],
  );

  const axisTicks = useMemo(
    () =>
      computeAxisTicksForTimezone(
        timelineWindow.fromMs,
        timelineWindow.toMs,
        activeTimezone,
      ),
    [timelineWindow.fromMs, timelineWindow.toMs, activeTimezone],
  );

  const resultByOperatorId = useMemo(() => {
    const map = new Map<number, OperatorTimelineResult>();
    for (const row of timelineResult?.operators ?? []) {
      map.set(row.operatorId, row);
    }
    return map;
  }, [timelineResult]);

  const timelineMutation = useMutation({
    mutationFn: async ({
      operatorIds,
      dateIso,
    }: {
      operatorIds: number[];
      dateIso: string;
    }) => {
      const requestWindow = buildUtcWindowIso(
        dateIso,
        workdayInterval.from,
        workdayInterval.to,
        activeTimezone,
      );

      return apiRequest<TimelineQueryResponse>("/timelines/query", {
          method: "POST",
          accessToken: accessToken ?? undefined,
          body: JSON.stringify({
            from: requestWindow.fromIso,
            to: requestWindow.toIso,
            operatorIds,
            timezone: activeTimezone,
          }),
      });
    },
    onMutate: () => {
      setValidationError(null);
      setTooltip(null);
    },
    onSuccess: (data) => {
      setTimelineResult(data);
      setTimelineData(data);
      setIsTimelineBuilt(true);
    },
    onError: (error) => {
      setValidationError(getApiErrorMessage(error));
    },
  });

  const onBuildTimeline = () => {
    const parsedDate = parseDisplayDateToIso(dateInput);
    if (!parsedDate.iso) {
      setDateInputError(parsedDate.error);
      return;
    }

    setDateInputError(null);
    if (parsedDate.iso !== selectedDate) {
      setSelectedDate(parsedDate.iso);
    }

    if (selectedVisibleOperatorIds.length === 0) {
      setValidationError("Выберите хотя бы одного оператора.");
      return;
    }
    timelineMutation.mutate({
      operatorIds: selectedVisibleOperatorIds,
      dateIso: parsedDate.iso,
    });
  };

  const onSelectVisible = () => {
    const merged = new Set(selectedOperatorIds);
    for (const operator of filteredOperators) {
      merged.add(operator.operatorId);
    }
    setSelectedOperatorIds([...merged].sort((a, b) => a - b));
  };

  const onClearVisible = () => {
    const visible = new Set(filteredOperators.map((item) => item.operatorId));
    setSelectedOperatorIds(
      selectedOperatorIds.filter((id) => !visible.has(id)),
    );
  };

  const onHoverSegment = (
    event: MouseEvent<HTMLButtonElement> | FocusEvent<HTMLButtonElement>,
    segment: TimelineTrackSegment,
  ) => {
    const target = event.currentTarget.getBoundingClientRect();
    const clientX =
      "clientX" in event ? event.clientX : target.left + target.width / 2;
    const clientY = "clientY" in event ? event.clientY : target.top;

    setTooltip({
      segmentKey: segment.key,
      segment,
      x: clientX,
      y: clientY,
    });
  };

  const statusTypes = useMemo(
    () => statusTypesQuery.data ?? [],
    [statusTypesQuery.data],
  );
  const catalogError =
    operatorsQuery.error ??
    queuesQuery.error ??
    groupsQuery.error ??
    statusTypesQuery.error ??
    credentialsQuery.error ??
    refreshCatalogMutation.error;

  const isCatalogLoading =
    operatorsQuery.isLoading ||
    queuesQuery.isLoading ||
    groupsQuery.isLoading ||
    statusTypesQuery.isLoading;

  const areCatalogsEmpty =
    (operatorsQuery.data?.length ?? 0) === 0 &&
    (groupsQuery.data?.length ?? 0) === 0 &&
    (queueOptions.length ?? 0) === 0 &&
    (statusTypes.length ?? 0) === 0;

  const catalogsLoaded =
    operatorsQuery.isFetched &&
    queuesQuery.isFetched &&
    groupsQuery.isFetched &&
    statusTypesQuery.isFetched;

  useEffect(() => {
    if (autoRefreshRef.current) {
      return;
    }
    if (!accessToken || !credentialsQuery.data?.tokenConfigured) {
      return;
    }
    if (!catalogsLoaded || !areCatalogsEmpty) {
      return;
    }

    autoRefreshRef.current = true;
    refreshCatalogMutation.mutate();
  }, [
    accessToken,
    areCatalogsEmpty,
    catalogsLoaded,
    credentialsQuery.data?.tokenConfigured,
    refreshCatalogMutation,
  ]);

  const statusConfigsByKey = useMemo<Record<string, StatusConfig>>(
    () =>
      Object.fromEntries(
        statusTypes.map((item) => [item.statusKey, { title: item.title, color: item.color, description: item.description }]),
      ),
    [statusTypes],
  );
  const isPending = timelineMutation.isPending;

  const onDateInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const normalized = normalizeDateInput(event.target.value);
    setDateInput(normalized);

    const parsed = parseDisplayDateToIso(normalized);
    if (parsed.iso) {
      if (selectedDate !== parsed.iso) {
        setSelectedDate(parsed.iso);
      }
      setDateInputError(null);
      return;
    }

    if (normalized.length === 0) {
      setDateInputError("Введите дату в формате ДД/ММ/ГГГГ.");
    } else if (normalized.length < 10) {
      setDateInputError("Дата должна быть полной: ДД/ММ/ГГГГ.");
    } else {
      setDateInputError(parsed.error);
    }
  };

  const onDateInputBlur = () => {
    const parsed = parseDisplayDateToIso(dateInput);
    if (!parsed.iso) {
      setDateInputError(parsed.error);
      return;
    }

    setDateInputError(null);
    setDateInput(formatIsoDateToDisplay(parsed.iso));
    if (selectedDate !== parsed.iso) {
      setSelectedDate(parsed.iso);
    }
  };

  const toggleExpandedOperator = (operatorId: number) => {
    setExpandedOperatorIds((current) => {
      const next = new Set(current);
      if (next.has(operatorId)) {
        next.delete(operatorId);
      } else {
        next.add(operatorId);
      }
      return next;
    });
  };

  const appliedFiltersSummary = useMemo(() => {
    const chunks: string[] = [];
    if (selectedGroupIds.length > 0) {
      chunks.push(`Группы: ${selectedGroupIds.length}`);
    }
    if (selectedQueueIds.length > 0) {
      chunks.push(`Очереди: ${selectedQueueIds.length}`);
    }
    if (searchText.trim().length > 0) {
      chunks.push(`Поиск: ${searchText.trim()}`);
    }
    if (chunks.length === 0) {
      return "Фильтры не выбраны";
    }
    return chunks.join(" · ");
  }, [selectedGroupIds.length, selectedQueueIds.length, searchText]);

  return (
    <section className="reports-shell">
      <header className="page-header compact">
        <div className="section-kicker">Отчеты</div>
        <h1>Отчеты по статусам операторов</h1>
        <p>
          Единый сценарий: параметры, фильтры, выбор операторов и визуализация
          на одной странице.
        </p>
      </header>

      <section className="card panel reports-block">
        <div className="reports-section-head">
          <h2>Параметры отчета</h2>
        </div>
        <div className="reports-grid reports-grid-a">
          <label className="field">
            <span>Дата</span>
            <input
              type="text"
              value={dateInput}
              onChange={onDateInputChange}
              onBlur={onDateInputBlur}
              placeholder="ДД/ММ/ГГГГ"
              inputMode="numeric"
              autoComplete="off"
              aria-invalid={dateInputError ? "true" : "false"}
              aria-describedby="reports-date-error"
              className={dateInputError ? "reports-date-input is-invalid" : "reports-date-input"}
            />
            {dateInputError && (
              <span id="reports-date-error" className="reports-date-error">
                {dateInputError}
              </span>
            )}
          </label>
          <label className="field">
            <span>Начало рабочего дня</span>
            <input
              type="time"
              value={workdayInterval.from}
              onChange={(event) =>
                setWorkdayInterval({
                  ...workdayInterval,
                  from: event.target.value || "00:00",
                })
              }
            />
          </label>
          <label className="field">
            <span>Окончание рабочего дня</span>
            <input
              type="time"
              value={workdayInterval.to}
              onChange={(event) =>
                setWorkdayInterval({
                  ...workdayInterval,
                  to: event.target.value || "23:59",
                })
              }
            />
          </label>
          <div
            className="reports-timezone-badge"
            title="Часовой пояс из данных операторов"
          >
            🌐 {timezoneBadge}
          </div>
        </div>
      </section>

      <div className="reports-generate-row">
        <button
          type="button"
          className="button button-primary"
          onClick={() => refreshCatalogMutation.mutate()}
          disabled={refreshCatalogMutation.isPending || !accessToken}
        >
          {refreshCatalogMutation.isPending
            ? "Обновляем данные..."
            : "Обновить данные"}
        </button>
      </div>

      <section className="card panel reports-block">
        <div className="reports-section-head">
          <div>
            <h2>Фильтры операторов</h2>
            <p className="muted">
              {catalogRefreshAt
                ? `Последнее обновление: ${new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(new Date(catalogRefreshAt))}`
                : "Каталог синхронизируется из Voximplant."}
            </p>
          </div>
          <div className="form-actions">
            <button
              type="button"
              className="button button-secondary"
              onClick={() => setIsFiltersCollapsed(!isFiltersCollapsed)}
            >
              {isFiltersCollapsed ? "Развернуть" : "Свернуть"}
            </button>
          </div>
        </div>

        {refreshCatalogMutation.isSuccess && (
          <div className="success-banner">Каталог обновлен.</div>
        )}

        {isCatalogLoading && (
          <div className="muted">Загружаем каталоги групп, очередей и операторов...</div>
        )}

        {credentialsQuery.isSuccess && !credentialsQuery.data.tokenConfigured && (
          <div className="error-banner">
            Подключение Voximplant не настроено. Перейдите в настройки подключения и сохраните корректные credentials.
          </div>
        )}

        {catalogsLoaded && areCatalogsEmpty && credentialsQuery.data?.tokenConfigured && (
          <div className="muted">
            Каталог пока пуст. Нажмите "Обновить данные", чтобы загрузить группы, очереди и операторов.
          </div>
        )}

        {catalogError && (
          <div className="error-banner">{getApiErrorMessage(catalogError)}</div>
        )}

        {isFiltersCollapsed ? (
          <div className="reports-collapsed-summary">{appliedFiltersSummary}</div>
        ) : (
          <>
            <div className="reports-filter-grid reports-filter-grid-compact">
              <div className="reports-filter-column">
                <strong>Группы</strong>
                <div className="reports-checklist">
                  {(groupsQuery.data ?? []).map((group) => (
                    <label key={group.id} className="reports-check-item">
                      <input
                        type="checkbox"
                        checked={selectedGroupIds.includes(group.groupId)}
                        onChange={() =>
                          setSelectedGroupIds(
                            toggleIdInArray(selectedGroupIds, group.groupId),
                          )
                        }
                      />
                      <span>{group.groupTitle}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="reports-filter-column">
                <strong>Очереди</strong>
                <div className="reports-checklist">
                  {queueOptions.map((queue) => (
                    <label key={queue.id} className="reports-check-item">
                      <input
                        type="checkbox"
                        checked={selectedQueueIds.includes(queue.queueId)}
                        onChange={() =>
                          setSelectedQueueIds(
                            toggleIdInArray(selectedQueueIds, queue.queueId),
                          )
                        }
                      />
                      <span>{queue.queueTitle}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <label className="field reports-operator-search">
              <span>Поиск оператора</span>
              <input
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="Поиск по имени или ID"
              />
            </label>
          </>
        )}
      </section>

      <section className="card panel reports-block">
        <div className="reports-section-head">
          <h2>Список операторов</h2>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => setIsOperatorsCollapsed(!isOperatorsCollapsed)}
          >
            {isOperatorsCollapsed ? "Развернуть" : "Свернуть"}
          </button>
        </div>

        {isOperatorsCollapsed ? (
          <div className="reports-collapsed-summary">
            {filteredOperators.length > 0
              ? `Отфильтровано операторов: ${filteredOperators.length}. Выбрано: ${selectedOperatorIds.length}`
              : "По выбранным фильтрам операторов нет"}
          </div>
        ) : (
          <>
            <div className="form-actions">
              <button
                type="button"
                className="button button-secondary"
                onClick={onSelectVisible}
              >
                Выбрать всех видимых
              </button>
              <button
                type="button"
                className="button button-secondary"
                onClick={onClearVisible}
              >
                Снять выбор
              </button>
              <span className="muted">Выбрано: {selectedOperatorIds.length}</span>
            </div>

            <div className="admin-table-wrap reports-operator-table-wrap">
              <table className="admin-table" data-testid="reports-operators-table">
                <thead>
                  <tr>
                    <th style={{ width: 52 }}>#</th>
                    <th>Оператор</th>
                    <th>Текущий статус</th>
                    <th>Время изменения статуса</th>
                    <th>Группа</th>
                    <th>Очередь</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOperators.map((operator) => {
                    const checked = selectedOperatorIds.includes(operator.operatorId);
                    const status = operator.payload?.call_status ?? "UNKNOWN";
                    const statusBadgeColor = statusColor(statusTypes, status);
                    const groupId = operator.payload?.group_id ?? null;
                    const groupLabel =
                      groupId !== null
                        ? (groupTitleById.get(groupId) ?? `Группа #${groupId}`)
                        : "—";
                    const queues = operatorQueueTitles.get(operator.operatorId) ?? [];

                    return (
                      <tr key={operator.id}>
                        <td>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setSelectedOperatorIds(
                                toggleIdInArray(selectedOperatorIds, operator.operatorId),
                              )
                            }
                          />
                        </td>
                        <td>
                          <strong>
                            {operator.fullName || `Оператор #${operator.operatorId}`}
                          </strong>
                          <div className="muted mono">ID: {operator.operatorId}</div>
                        </td>
                        <td>
                          <span
                            className="reports-status-pill"
                            style={{
                              borderColor: statusBadgeColor,
                              color: statusBadgeColor,
                            }}
                          >
                            {statusTitle(statusTypes, status)}
                          </span>
                        </td>
                        <td>
                          {formatStatusChangedAt(
                            operator.payload?.call_status_change_time,
                            activeTimezone,
                          )}
                        </td>
                        <td>{groupLabel}</td>
                        <td>{queues.length > 0 ? queues.join(", ") : "—"}</td>
                      </tr>
                    );
                  })}
                  {filteredOperators.length === 0 && (
                    <tr>
                      <td colSpan={6} className="admin-empty-cell">
                        По фильтрам операторы не найдены
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <div className="reports-generate-row">
        <button
          type="button"
          className="button button-primary"
          onClick={onBuildTimeline}
          disabled={isPending || !accessToken}
        >
          Визуализировать
        </button>
      </div>

      {isPending && (
        <div className="muted">Выполняется загрузка статусов...</div>
      )}
      {validationError && <div className="error-banner">{validationError}</div>}

      <section className="card panel reports-block">
        <div className="reports-section-head">
          <h2>Таймлайн</h2>
        </div>

        <div className="timeline2-scroll">
          <div className="timeline2-content">
            <div className="timeline2-axis" data-testid="reports-axis">
              <div className="timeline2-axis-label" />
              <div className="timeline2-axis-track">
                {axisTicks.map((tick) => (
                  <span
                    key={`${tick.label}-${tick.leftPct}`}
                    className="timeline2-axis-tick"
                    style={{ left: `${tick.leftPct}%` }}
                  >
                    {tick.label}
                  </span>
                ))}
              </div>
            </div>

            {isPending && (
              <div className="timeline2-skeleton-wrap">
                {selectedVisibleOperatorIds.slice(0, 5).map((operatorId) => (
                  <div
                    key={operatorId}
                    className="timeline2-row timeline2-row-skeleton"
                  >
                    <div className="timeline2-row-meta">
                      <div className="timeline2-skeleton-meta" />
                      <div className="timeline2-skeleton-submeta" />
                    </div>
                    <div className="timeline2-skeleton-track" />
                  </div>
                ))}
              </div>
            )}

            {!isPending && !timelineResult && (
              <div className="timeline2-empty">
                Постройте таймлайн, чтобы увидеть визуализацию по выбранным
                операторам.
              </div>
            )}

            {!isPending && timelineResult && (
              <div className="timeline2-rows" data-testid="reports-rows">
                {selectedVisibleOperators.map((operator) => {
                  const row = resultByOperatorId.get(operator.operatorId);
                  const isExpanded = expandedOperatorIds.has(operator.operatorId);
                  const positioned = computeTrackSegments(
                    row?.presentation ?? [],
                    timelineWindow.fromMs,
                    timelineWindow.toMs,
                  );
                  const summaryIntervals: StatusInterval[] = row?.presentation ?? [];

                  return (
                    <div
                      key={operator.operatorId}
                      className={`timeline2-row reports-operator-row ${isExpanded ? "is-expanded" : ""}`}
                      role="button"
                      tabIndex={0}
                      aria-expanded={isExpanded}
                      onClick={() => toggleExpandedOperator(operator.operatorId)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          toggleExpandedOperator(operator.operatorId);
                        }
                      }}
                    >
                      <div className="timeline2-row-meta">
                        <div className="reports-operator-title-row">
                          <strong>
                            {operator.fullName || `Оператор #${operator.operatorId}`}
                          </strong>
                        </div>
                        <span>ID {operator.operatorId}</span>
                      </div>

                      <div className="timeline2-row-track-cell">
                        {!row && (
                          <div className="timeline2-track timeline2-track-empty">
                            Нет построенного таймлайна
                          </div>
                        )}

                        {row && !row.ok && (
                          <div className="timeline2-track timeline2-track-error">
                            {row.error || "Ошибка загрузки таймлайна"}
                          </div>
                        )}

                        {row?.ok && (
                          <div className="timeline2-track" data-testid="reports-track">
                            {positioned.length === 0 && (
                              <div className="timeline2-track-no-data">
                                Информация о статусе отсутствует
                              </div>
                            )}

                            {positioned.map((segment) => {
                              const color = statusColor(
                                statusTypes,
                                segment.status,
                                segment.isSystem,
                              );
                              const title = statusTitle(statusTypes, segment.status);
                              const hovered = tooltip?.segmentKey === segment.key;

                              return (
                                <button
                                  key={segment.key}
                                  type="button"
                                  className={`timeline2-segment ${hovered ? "is-hovered" : ""}`}
                                  data-testid="reports-segment"
                                  style={{
                                    left: `${segment.leftPct}%`,
                                    width: `${segment.widthPct}%`,
                                    backgroundColor: color,
                                  }}
                                  onMouseEnter={(event) => onHoverSegment(event, segment)}
                                  onMouseMove={(event) =>
                                    setTooltip((current) =>
                                      current
                                        ? {
                                            ...current,
                                            x: event.clientX,
                                            y: event.clientY,
                                          }
                                        : current,
                                    )
                                  }
                                  onMouseLeave={() => setTooltip(null)}
                                  onFocus={(event) => onHoverSegment(event, segment)}
                                  onBlur={() => setTooltip(null)}
                                  aria-label={`${title}: ${formatDuration(segment.durationSec)}`}
                                />
                              );
                            })}
                          </div>
                        )}
                      </div>

                      <div
                        className={`reports-operator-summary-shell ${isExpanded ? "is-open" : ""}`}
                        aria-hidden={!isExpanded}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <div className="reports-operator-summary-card">
                          <OperatorStatusSummary
                            intervals={summaryIntervals}
                            statusesMap={statusConfigsByKey}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </section>

      {tooltip && (
        <div
          className="timeline2-tooltip"
          role="tooltip"
          style={{
            left: Math.max(12, tooltip.x + 12),
            top: Math.max(12, tooltip.y + 12),
          }}
        >
          <div className="timeline2-tooltip-head">
            <span
              className="timeline2-tooltip-color"
              style={{
                backgroundColor: statusColor(
                  statusTypes,
                  tooltip.segment.status,
                  tooltip.segment.isSystem,
                ),
              }}
            />
            <strong>{statusTitle(statusTypes, tooltip.segment.status)}</strong>
          </div>
          <div className="timeline2-tooltip-time">
            {formatLocalTimeFromMs(tooltip.segment.startMs, activeTimezone, false)}{" "}
            - {" "}
            {formatLocalTimeFromMs(tooltip.segment.endMs, activeTimezone, false)}
          </div>
          <div className="timeline2-tooltip-duration">
            {formatDuration(tooltip.segment.durationSec)}
          </div>
        </div>
      )}
    </section>
  );
}
