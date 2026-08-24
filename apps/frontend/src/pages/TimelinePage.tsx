import { useMutation, useQuery } from "@tanstack/react-query";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type MouseEvent,
} from "react";
import { apiRequest, getApiErrorMessage } from "../lib/api";
import { useAuthStore } from "../state/auth";
import {
  deriveQueueSelection,
  getOperatorsByQueue,
  getSelectedVisibleOperatorIds,
  getSelectedVisibleOperators,
  buildQueueMemberships,
  type QueueCatalogItem,
} from "./timeline-selection-utils";
import {
  buildUtcWindowIso,
  computeAxisTicksForTimezone,
  computeTrackSegments,
  computeWorkingHoursOverlay,
  fallbackStatusColor,
  formatLocalTimeFromMs,
  normalizeStatusColor,
  resolveTimelineTimezone,
  type TimelineTrackSegment,
  type TimelineSegmentPresentation,
} from "./timeline-utils";

type TimelineAggregate = {
  status: string;
  durationSec: number;
  percentage: number;
};

type OperatorTimelineResult = {
  operatorId: number;
  ok: boolean;
  error?: string;
  aggregates?: {
    windowDurationSec: number;
    measurableDurationSec: number;
    noDataDurationSec: number;
    byStatus: TimelineAggregate[];
  };
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
  fullName: string | null;
  timezone: string | null;
};

type QueueSnapshot = QueueCatalogItem & {
  refreshedAt: string;
};

type StatusTypeSnapshot = {
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

type TimelinePageState = {
  selectedQueueId?: number | null;
  selectedDate?: string;
  displayFrom?: string;
  displayTo?: string;
  workFrom?: string;
  workTo?: string;
};

type Preferences = {
  timelinePageState?: TimelinePageState;
  operatorsPageState?: { selectedQueueId?: number | null };
};

type TimelineQueryPayload = {
  operatorIds: number[];
  merge: boolean;
};

type TooltipState = {
  segmentKey: string;
  operatorId: number;
  x: number;
  y: number;
  operatorName: string;
  operatorTimezone?: string | null;
  segment: TimelineTrackSegment;
};

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

function statusDescription(
  statusTypes: StatusTypeSnapshot[],
  status: string,
): string {
  const found = statusTypes.find((item) => item.statusKey === status);
  return found?.description?.trim() || "Описание статуса отсутствует";
}

function statusTitle(
  statusTypes: StatusTypeSnapshot[],
  status: string,
): string {
  const found = statusTypes.find((item) => item.statusKey === status);
  return found?.title?.trim() || status;
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
  if (normalized) {
    return normalized;
  }

  return fallbackStatusColor(status);
}

function mergeOperatorResults(
  prev: TimelineQueryResponse | null,
  next: TimelineQueryResponse,
): TimelineQueryResponse {
  if (!prev) {
    return next;
  }

  const byOperatorId = new Map<number, OperatorTimelineResult>();
  for (const item of prev.operators) {
    byOperatorId.set(item.operatorId, item);
  }
  for (const item of next.operators) {
    byOperatorId.set(item.operatorId, item);
  }

  return {
    ...prev,
    from: next.from,
    to: next.to,
    timezone: next.timezone,
    operators: [...byOperatorId.values()].sort(
      (a, b) => a.operatorId - b.operatorId,
    ),
  };
}

const OPERATORS_PANEL_STORAGE_KEY = "timeline2-operators-expanded";

function readOperatorsPanelState(): boolean {
  if (typeof globalThis.window === "undefined") {
    return true;
  }

  const saved = globalThis.window.localStorage.getItem(
    OPERATORS_PANEL_STORAGE_KEY,
  );
  if (saved === null) {
    return true;
  }

  return saved === "1";
}

function resolveOperatorGridColumns(width: number): 1 | 2 | 3 | 4 {
  if (width <= 600) return 1;
  if (width <= 900) return 2;
  if (width <= 1200) return 3;
  return 4;
}

export function TimelineFilterToolbar(props: {
  selectedDate: string;
  displayFrom: string;
  displayTo: string;
  workFrom: string;
  workTo: string;
  selectedQueueId: number | "all";
  queueOptions: Array<{
    queueId: number;
    queueTitle: string;
    usersCount: number;
  }>;
  queuesLoading: boolean;
  queuesError: boolean;
  timezone: ReturnType<typeof resolveTimelineTimezone>;
  isPending: boolean;
  isDisabled: boolean;
  onBuild: () => void;
  onDateChange: (value: string) => void;
  onDisplayFromChange: (value: string) => void;
  onDisplayToChange: (value: string) => void;
  onWorkFromChange: (value: string) => void;
  onWorkToChange: (value: string) => void;
  onQueueChange: (value: number | "all") => void;
  onRetryQueues: () => void;
}) {
  const timezoneTooltip = props.timezone.warning
    ? `Автоматически определено по выбранным операторам.\n\n${props.timezone.warning}`
    : `Автоматически определено по выбранным операторам.`;
  const selectedQueueTitle =
    props.selectedQueueId === "all"
      ? "Все очереди"
      : (props.queueOptions.find(
          (queue) => queue.queueId === props.selectedQueueId,
        )?.queueTitle ?? `Очередь #${props.selectedQueueId}`);

  return (
    <div className="timeline2-toolbar" data-testid="timeline-filter-toolbar">
      <div
        className="timeline2-filter-group"
        data-testid="timeline-filter-group-date"
      >
        <span className="timeline2-filter-label">Дата</span>
        <div className="timeline2-filter-inline">
          <input
            data-testid="timeline-date-input"
            className="timeline2-input timeline2-input-date"
            type="date"
            value={props.selectedDate}
            onChange={(event) => props.onDateChange(event.target.value)}
            style={{ height: "40px" }}
          />
        </div>
      </div>

      <div
        className="timeline2-filter-group"
        data-testid="timeline-filter-group-display-period"
      >
        <span className="timeline2-filter-label">Показывать</span>
        <div className="timeline2-filter-inline timeline2-filter-inline-period">
          <input
            data-testid="timeline-display-from"
            className="timeline2-input timeline2-input-time"
            type="time"
            value={props.displayFrom}
            onChange={(event) =>
              props.onDisplayFromChange(event.target.value || "00:00")
            }
            style={{ height: "40px", width: "124px" }}
          />
          <span className="timeline2-inline-divider" aria-hidden="true">
            —
          </span>
          <input
            data-testid="timeline-display-to"
            className="timeline2-input timeline2-input-time"
            type="time"
            value={props.displayTo}
            onChange={(event) =>
              props.onDisplayToChange(event.target.value || "23:59")
            }
            style={{ height: "40px", width: "124px" }}
          />
        </div>
      </div>

      <div
        className="timeline2-filter-group"
        data-testid="timeline-filter-group-working-hours"
      >
        <span className="timeline2-filter-label">Рабочее время</span>
        <div className="timeline2-filter-inline timeline2-filter-inline-period">
          <input
            data-testid="timeline-work-from"
            className="timeline2-input timeline2-input-time"
            type="time"
            value={props.workFrom}
            onChange={(event) =>
              props.onWorkFromChange(event.target.value || "00:00")
            }
            style={{ height: "40px", width: "124px" }}
          />
          <span className="timeline2-inline-divider" aria-hidden="true">
            —
          </span>
          <input
            data-testid="timeline-work-to"
            className="timeline2-input timeline2-input-time"
            type="time"
            value={props.workTo}
            onChange={(event) =>
              props.onWorkToChange(event.target.value || "23:59")
            }
            style={{ height: "40px", width: "124px" }}
          />
        </div>
      </div>

      <div
        className="timeline2-filter-group timeline2-filter-group-queue"
        data-testid="timeline-filter-group-queue"
      >
        <span className="timeline2-filter-label">Очередь</span>
        <select
          data-testid="timeline-queue-select"
          className="timeline2-input timeline2-input-select"
          value={props.selectedQueueId}
          onChange={(event) =>
            props.onQueueChange(
              event.target.value === "all" ? "all" : Number(event.target.value),
            )
          }
          disabled={props.queuesLoading || props.queuesError}
          title={
            props.queuesLoading ? "Загрузка очередей…" : selectedQueueTitle
          }
          style={{ height: "40px" }}
        >
          {props.queuesLoading ? (
            <option value="all">Загрузка очередей…</option>
          ) : (
            <>
              <option value="all">Все очереди</option>
              {props.queueOptions.map((queue) => (
                <option
                  key={queue.queueId}
                  value={queue.queueId}
                  title={queue.queueTitle}
                >
                  {queue.queueTitle}{" "}
                  {queue.usersCount ? `(${queue.usersCount})` : ""}
                </option>
              ))}
            </>
          )}
        </select>
        {props.queuesError && (
          <div className="timeline2-queue-error">
            <span>Не удалось загрузить очереди.</span>
            <button
              type="button"
              className="ghost timeline2-btn-secondary"
              onClick={props.onRetryQueues}
            >
              Повторить
            </button>
          </div>
        )}
      </div>

      <div
        className="timeline2-filter-group timeline2-filter-group-timezone"
        data-testid="timeline-timezone-readonly"
      >
        <span className="timeline2-filter-label">Часовой пояс</span>
        <div className="timeline2-timezone-info" title={timezoneTooltip}>
          <span aria-hidden="true">🌐</span>
          <span>{props.timezone.label}</span>
          {props.timezone.warning && (
            <span
              className="timeline2-timezone-warning-icon"
              aria-label="Есть различие timezone операторов"
            >
              ⚠
            </span>
          )}
        </div>
      </div>

      <div className="timeline2-filter-group timeline2-filter-group-action">
        <span className="timeline2-filter-label">Действие</span>
        <button
          className="timeline2-build-btn"
          type="button"
          onClick={props.onBuild}
          disabled={props.isPending || props.isDisabled}
          style={{ height: "42px", width: "auto" }}
        >
          {props.isPending ? "Построение..." : "Построить"}
        </button>
      </div>
    </div>
  );
}

function OperatorsSelectionPanel(props: {
  operators: OperatorCatalogItem[];
  totalOperatorsCount: number;
  selectedVisibleCount: number;
  totalSelectedCount: number;
  selectedPreviewNames: string[];
  selectedOperatorIds: number[];
  searchText: string;
  isExpanded: boolean;
  columnCount: 1 | 2 | 3 | 4;
  controlsId: string;
  queueLabel: string;
  hasNoOperatorsInQueue: boolean;
  onSearchChange: (value: string) => void;
  onToggleExpanded: () => void;
  onSelectVisible: () => void;
  onClearVisible: () => void;
  onToggleOperator: (operatorId: number, checked: boolean) => void;
  onSelectAnotherQueue: () => void;
  onRetryOperators: () => void;
}) {
  const searchActive = props.searchText.trim().length > 0;
  const selectLabel = searchActive ? "Выбрать найденных" : "Выбрать всех";
  const clearLabel = searchActive ? "Снять найденных" : "Снять выбор";

  return (
    <div
      className="card timeline2-operators-card"
      data-testid="timeline-operators-panel"
    >
      <div className="timeline2-operators-header">
        <div className="timeline2-operators-title-wrap">
          <h2 className="timeline2-operators-title">Операторы</h2>
          <span className="status-badge">
            Выбрано в текущей очереди: {props.selectedVisibleCount}
          </span>
          <span className="status-badge">
            Всего сохранено: {props.totalSelectedCount}
          </span>
        </div>
        <button
          type="button"
          className="ghost timeline2-disclosure-btn"
          aria-expanded={props.isExpanded}
          aria-controls={props.controlsId}
          onClick={props.onToggleExpanded}
        >
          {props.isExpanded ? "Скрыть список ∧" : "Показать список ∨"}
        </button>
      </div>

      {props.isExpanded ? (
        <div
          id={props.controlsId}
          className="timeline2-operators-body"
          data-testid="timeline-operators-content"
        >
          <div className="timeline2-operators-queue-note">
            <span className="muted">Очередь: {props.queueLabel}</span>
          </div>

          {props.hasNoOperatorsInQueue && (
            <div
              className="timeline2-empty compact"
              data-testid="timeline-empty-queue"
            >
              <strong>В этой очереди нет операторов</strong>
              <p>Выберите другую очередь или обновите данные.</p>
              <div className="form-actions">
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={props.onSelectAnotherQueue}
                >
                  Выбрать другую очередь
                </button>
                <button
                  type="button"
                  className="button button-primary"
                  onClick={props.onRetryOperators}
                >
                  Обновить данные
                </button>
              </div>
            </div>
          )}

          {!props.hasNoOperatorsInQueue && (
            <div className="timeline2-operators-toolbar">
              <label className="timeline2-control timeline2-search-control">
                <span>Поиск</span>
                <input
                  type="text"
                  value={props.searchText}
                  onChange={(event) => props.onSearchChange(event.target.value)}
                  placeholder="Поиск по имени или ID"
                />
              </label>

              <span className="timeline2-selected-inline">
                Выбрано: {props.selectedOperatorIds.length}
              </span>

              <button
                type="button"
                className="ghost"
                onClick={props.onSelectVisible}
                disabled={!props.operators.length}
                title={
                  searchActive
                    ? "Выбрать всех операторов из найденного списка"
                    : undefined
                }
              >
                {selectLabel}
              </button>

              <button
                type="button"
                className="ghost"
                onClick={props.onClearVisible}
                disabled={!props.operators.length}
                title={
                  searchActive
                    ? "Снять выбор у всех операторов из найденного списка"
                    : undefined
                }
              >
                {clearLabel}
              </button>
            </div>
          )}

          {!props.hasNoOperatorsInQueue && (
            <div
              className="timeline2-operators-scroll"
              data-testid="timeline-operators-scroll-area"
            >
              <div
                className="timeline2-operator-list"
                data-testid="timeline-operator-grid"
                data-columns={props.columnCount}
                style={{
                  gridTemplateColumns: `repeat(${props.columnCount}, minmax(0, 1fr))`,
                }}
              >
                {props.operators.map((operator) => {
                  const checked = props.selectedOperatorIds.includes(
                    operator.operatorId,
                  );
                  const fullName =
                    operator.fullName?.trim() ||
                    `Оператор #${operator.operatorId}`;

                  return (
                    <label
                      key={operator.id}
                      className={`timeline2-operator-row ${checked ? "selected" : ""}`}
                      title={fullName}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) =>
                          props.onToggleOperator(
                            operator.operatorId,
                            event.target.checked,
                          )
                        }
                        style={{
                          width: "18px",
                          height: "18px",
                          accentColor: "#8B55FF",
                        }}
                      />
                      <span className="timeline2-operator-row-main">
                        <strong>{fullName}</strong>
                        <small>ID {operator.operatorId}</small>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div
          id={props.controlsId}
          className="timeline2-operators-collapsed"
          data-testid="timeline-operators-collapsed"
        >
          <span>
            Выбрано в очереди: {props.selectedVisibleCount} из{" "}
            {props.operators.length || 0}
          </span>
          <span>Всего сохранено: {props.totalSelectedCount}</span>
          {props.selectedPreviewNames.length > 0 && (
            <span className="timeline2-operators-preview">
              {props.selectedPreviewNames.slice(0, 3).join(", ")}
              {props.selectedPreviewNames.length > 3
                ? ` +${props.selectedPreviewNames.length - 3}`
                : ""}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export function TimelinePage() {
  const accessToken = useAuthStore((state) => state.accessToken);
  const [selectedDate, setSelectedDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [displayFrom, setDisplayFrom] = useState("08:00");
  const [displayTo, setDisplayTo] = useState("20:00");
  const [workFrom, setWorkFrom] = useState("09:00");
  const [workTo, setWorkTo] = useState("18:00");
  const [searchText, setSearchText] = useState("");
  const [selectedQueueId, setSelectedQueueId] = useState<number | "all">("all");
  const [selectedOperatorIds, setSelectedOperatorIds] = useState<number[]>([]);
  const [operatorsExpanded, setOperatorsExpanded] = useState(
    readOperatorsPanelState,
  );
  const [operatorGridColumns, setOperatorGridColumns] = useState<1 | 2 | 3 | 4>(
    () => {
      if (typeof globalThis.window === "undefined") {
        return 4;
      }
      return resolveOperatorGridColumns(globalThis.window.innerWidth);
    },
  );
  const [validationError, setValidationError] = useState<string | null>(null);
  const [result, setResult] = useState<TimelineQueryResponse | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const operatorsPanelId = useId();
  const selectionInitRef = useRef(false);

  useEffect(() => {
    if (typeof globalThis.window === "undefined") {
      return;
    }

    globalThis.window.localStorage.setItem(
      OPERATORS_PANEL_STORAGE_KEY,
      operatorsExpanded ? "1" : "0",
    );
  }, [operatorsExpanded]);

  useEffect(() => {
    if (typeof globalThis.window === "undefined") {
      return;
    }

    const onResize = () => {
      setOperatorGridColumns(
        resolveOperatorGridColumns(globalThis.window.innerWidth),
      );
    };

    onResize();
    globalThis.window.addEventListener("resize", onResize);
    return () => globalThis.window.removeEventListener("resize", onResize);
  }, []);

  const operatorsQuery = useQuery({
    queryKey: ["timeline-operators-catalog"],
    queryFn: () =>
      apiRequest<OperatorCatalogItem[]>("/catalog/operators", {
        accessToken: accessToken ?? undefined,
      }),
    enabled: !!accessToken,
  });

  const queuesQuery = useQuery({
    queryKey: ["timeline-queues-catalog"],
    queryFn: () =>
      apiRequest<QueueSnapshot[]>("/catalog/queues", {
        accessToken: accessToken ?? undefined,
      }),
    enabled: !!accessToken,
    staleTime: 5 * 60 * 1000,
  });

  const preferencesQuery = useQuery({
    queryKey: ["preferences"],
    queryFn: () =>
      apiRequest<Preferences>("/preferences", {
        accessToken: accessToken ?? undefined,
      }),
    enabled: !!accessToken,
    staleTime: 60_000,
  });

  const statusTypesQuery = useQuery({
    queryKey: ["timeline-status-types"],
    queryFn: () =>
      apiRequest<StatusTypeSnapshot[]>("/catalog/status-types", {
        accessToken: accessToken ?? undefined,
      }),
    enabled: !!accessToken,
    staleTime: 12 * 60 * 60 * 1000,
  });

  const selectionsQuery = useQuery({
    queryKey: ["timeline-operator-selections"],
    queryFn: () =>
      apiRequest<SavedSelection[]>("/operator-selections", {
        accessToken: accessToken ?? undefined,
      }),
    enabled: !!accessToken,
    staleTime: 60_000,
  });

  const operatorOptions = useMemo(
    () => operatorsQuery.data ?? [],
    [operatorsQuery.data],
  );
  const queueOptions = useMemo(
    () => queuesQuery.data ?? [],
    [queuesQuery.data],
  );
  const statusTypes = useMemo(
    () => statusTypesQuery.data ?? [],
    [statusTypesQuery.data],
  );
  const queueMemberships = useMemo(
    () => buildQueueMemberships(queueOptions),
    [queueOptions],
  );

  const savedQueueId = useMemo(() => {
    const preferred = preferencesQuery.data?.timelinePageState?.selectedQueueId;
    if (typeof preferred === "number") {
      return preferred;
    }

    const operatorsPageQueue =
      preferencesQuery.data?.operatorsPageState?.selectedQueueId;
    return typeof operatorsPageQueue === "number" ? operatorsPageQueue : null;
  }, [preferencesQuery.data]);

  const queueOptionsById = useMemo(() => {
    const map = new Map<number, QueueSnapshot>();
    for (const queue of queueOptions) {
      map.set(queue.queueId, queue);
    }
    return map;
  }, [queueOptions]);

  const queueFilteredOperators = useMemo(() => {
    return getOperatorsByQueue({
      operators: operatorOptions,
      queueId: selectedQueueId === "all" ? null : selectedQueueId,
      queueMemberships,
    });
  }, [operatorOptions, selectedQueueId, queueMemberships]);

  const filteredOperators = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    if (!query) {
      return queueFilteredOperators;
    }

    return queueFilteredOperators.filter((item) => {
      const fullName = item.fullName?.trim().toLowerCase() || "";
      const zone = item.timezone?.toLowerCase() || "";
      return (
        fullName.includes(query) ||
        zone.includes(query) ||
        String(item.operatorId).includes(query)
      );
    });
  }, [queueFilteredOperators, searchText]);

  const selectedVisibleOperators = useMemo(
    () =>
      getSelectedVisibleOperators({ filteredOperators, selectedOperatorIds }),
    [filteredOperators, selectedOperatorIds],
  );

  const selectedVisibleOperatorIds = useMemo(
    () =>
      getSelectedVisibleOperatorIds({ filteredOperators, selectedOperatorIds }),
    [filteredOperators, selectedOperatorIds],
  );

  const queueLabel = useMemo(() => {
    if (selectedQueueId === "all") {
      return "Все очереди";
    }
    return (
      queueOptionsById.get(selectedQueueId)?.queueTitle ??
      `Очередь #${selectedQueueId}`
    );
  }, [selectedQueueId, queueOptionsById]);

  const currentQueueOperators = useMemo(
    () =>
      getOperatorsByQueue({
        operators: operatorOptions,
        queueId: selectedQueueId === "all" ? null : selectedQueueId,
        queueMemberships,
      }),
    [operatorOptions, selectedQueueId, queueMemberships],
  );

  const currentQueueIsEmpty =
    selectedQueueId !== "all" && currentQueueOperators.length === 0;

  const totalSelectedCount = selectedOperatorIds.length;
  const selectedVisibleCount = selectedVisibleOperators.length;

  useEffect(() => {
    if (selectionInitRef.current) {
      return;
    }

    if (
      !operatorOptions.length ||
      !selectionsQuery.data ||
      !queuesQuery.data ||
      !preferencesQuery.data
    ) {
      return;
    }

    const saved = selectionsQuery.data.find(
      (item) => item.name === "Timeline selection",
    );
    if (saved) {
      const knownOperatorIds = new Set(
        operatorOptions.map((item) => item.operatorId),
      );
      const nextIds = [...new Set(saved.items.map((item) => item.operatorId))]
        .filter((id) => knownOperatorIds.has(id))
        .sort((a, b) => a - b);
      setSelectedOperatorIds(nextIds);

      const savedTimelineState = preferencesQuery.data.timelinePageState;
      const preferredQueue = deriveQueueSelection({
        savedQueueId:
          typeof savedTimelineState?.selectedQueueId === "number"
            ? savedTimelineState.selectedQueueId
            : savedQueueId,
        selectedOperatorIds: nextIds,
        queueMemberships,
      });
      setSelectedQueueId(preferredQueue ?? "all");
    }

    const savedTimelineState = preferencesQuery.data.timelinePageState;
    if (savedTimelineState?.selectedDate)
      setSelectedDate(savedTimelineState.selectedDate);
    if (savedTimelineState?.displayFrom)
      setDisplayFrom(savedTimelineState.displayFrom);
    if (savedTimelineState?.displayTo)
      setDisplayTo(savedTimelineState.displayTo);
    if (savedTimelineState?.workFrom) setWorkFrom(savedTimelineState.workFrom);
    if (savedTimelineState?.workTo) setWorkTo(savedTimelineState.workTo);

    selectionInitRef.current = true;
  }, [
    operatorOptions,
    selectionsQuery.data,
    queuesQuery.data,
    preferencesQuery.data,
    savedQueueId,
    queueMemberships,
    selectionInitRef,
  ]);

  const selectedOperatorPreviewNames = useMemo(
    () =>
      selectedVisibleOperators.map(
        (item) => item.fullName?.trim() || `Оператор #${item.operatorId}`,
      ),
    [selectedVisibleOperators],
  );

  const timezone = useMemo(
    () =>
      resolveTimelineTimezone(filteredOperators, selectedVisibleOperatorIds),
    [filteredOperators, selectedVisibleOperatorIds],
  );

  const timelineWindow = useMemo(
    () =>
      buildUtcWindowIso(
        selectedDate,
        displayFrom,
        displayTo,
        timezone.backendTimezone,
      ),
    [selectedDate, displayFrom, displayTo, timezone.backendTimezone],
  );

  const workingOverlay = useMemo(
    () =>
      computeWorkingHoursOverlay(
        selectedDate,
        displayFrom,
        displayTo,
        workFrom,
        workTo,
        timezone.backendTimezone,
      ),
    [
      selectedDate,
      displayFrom,
      displayTo,
      workFrom,
      workTo,
      timezone.backendTimezone,
    ],
  );

  const axisTicks = useMemo(
    () =>
      computeAxisTicksForTimezone(
        timelineWindow.fromMs,
        timelineWindow.toMs,
        timezone.backendTimezone,
      ),
    [timelineWindow.fromMs, timelineWindow.toMs, timezone.backendTimezone],
  );

  const resultByOperatorId = useMemo(() => {
    const map = new Map<number, OperatorTimelineResult>();
    for (const row of result?.operators ?? []) {
      map.set(row.operatorId, row);
    }
    return map;
  }, [result]);

  const timelineMutation = useMutation({
    mutationFn: async (payload: TimelineQueryPayload) => {
      return apiRequest<TimelineQueryResponse>("/timelines/query", {
        method: "POST",
        accessToken: accessToken ?? undefined,
        body: JSON.stringify({
          from: timelineWindow.fromIso,
          to: timelineWindow.toIso,
          operatorIds: payload.operatorIds,
          timezone: timezone.backendTimezone,
        }),
      });
    },
    onMutate: () => {
      setTooltip(null);
      setValidationError(null);
    },
    onSuccess: (data, variables) => {
      setResult((prev) =>
        variables.merge ? mergeOperatorResults(prev, data) : data,
      );
      if (!variables.merge && data.operators.some((row) => row.ok)) {
        setOperatorsExpanded(false);
      }
    },
    onError: (error) => {
      setValidationError(getApiErrorMessage(error));
    },
  });

  const selectAllVisible = () => {
    setSelectedOperatorIds((current) => {
      const merged = new Set(current);
      for (const item of filteredOperators) {
        merged.add(item.operatorId);
      }
      return [...merged].sort((a, b) => a - b);
    });
  };

  const clearVisible = () => {
    const visible = new Set(filteredOperators.map((item) => item.operatorId));
    setSelectedOperatorIds((current) =>
      current.filter((operatorId) => !visible.has(operatorId)),
    );
  };

  const runQuery = (operatorIds: number[], merge = false) => {
    if (!operatorIds.length) {
      setValidationError(
        selectedQueueId === "all"
          ? "Выберите хотя бы одного оператора."
          : "Выберите хотя бы одного оператора из этой очереди",
      );
      setOperatorsExpanded(true);
      return;
    }

    timelineMutation.mutate({ operatorIds, merge });
  };

  const onSegmentHover = (
    event: MouseEvent<HTMLButtonElement> | FocusEvent<HTMLButtonElement>,
    operatorId: number,
    operatorName: string,
    operatorTimezone: string | null | undefined,
    segment: TimelineTrackSegment,
    segmentKey: string,
  ) => {
    const target = event.currentTarget.getBoundingClientRect();
    const clientX =
      "clientX" in event ? event.clientX : target.left + target.width / 2;
    const clientY = "clientY" in event ? event.clientY : target.top;

    setTooltip({
      segmentKey,
      operatorId,
      x: clientX,
      y: clientY,
      operatorName,
      operatorTimezone,
      segment,
    });
  };

  const onSegmentLeave = (segmentKey: string) => {
    setTooltip((current) => {
      if (!current || current.segmentKey !== segmentKey) {
        return current;
      }
      return null;
    });
  };

  const onSegmentMove = (event: MouseEvent<HTMLButtonElement>) => {
    const x = event.clientX;
    const y = event.clientY;
    setTooltip((current) => {
      if (!current) return current;
      return {
        ...current,
        x,
        y,
      };
    });
  };

  const windowSpansMultipleDates = useMemo(() => {
    return (
      timelineWindow.toIso.slice(0, 10) !== timelineWindow.fromIso.slice(0, 10)
    );
  }, [timelineWindow.fromIso, timelineWindow.toIso]);

  const isPending = timelineMutation.isPending;

  const allSelectedRowsResolved = useMemo(() => {
    if (selectedVisibleOperators.length === 0) {
      return false;
    }
    return selectedVisibleOperators.every((operator) =>
      resultByOperatorId.has(operator.operatorId),
    );
  }, [selectedVisibleOperators, resultByOperatorId]);

  const hasOperatorErrors = useMemo(() => {
    return selectedVisibleOperators.some((operator) => {
      const row = resultByOperatorId.get(operator.operatorId);
      return !!row && !row.ok;
    });
  }, [selectedVisibleOperators, resultByOperatorId]);

  const hasNoDataForToday = useMemo(() => {
    if (!allSelectedRowsResolved || hasOperatorErrors) {
      return false;
    }

    return selectedVisibleOperators.every((operator) => {
      const row = resultByOperatorId.get(operator.operatorId);
      return !!row?.ok && (row.presentation ?? []).length === 0;
    });
  }, [
    allSelectedRowsResolved,
    hasOperatorErrors,
    selectedVisibleOperators,
    resultByOperatorId,
  ]);

  const buildDisabled =
    isPending ||
    !selectedVisibleOperatorIds.length ||
    queuesQuery.isLoading ||
    queuesQuery.isError ||
    !accessToken;

  return (
    <section className="timeline2-shell">
      <header className="timeline2-page-header">
        <h1>Таймлайн</h1>
        <p>Один оператор = одна строка = один цельный timeline track.</p>
      </header>

      <div className="card timeline2-filters-card">
        <TimelineFilterToolbar
          selectedDate={selectedDate}
          displayFrom={displayFrom}
          displayTo={displayTo}
          workFrom={workFrom}
          workTo={workTo}
          selectedQueueId={selectedQueueId}
          queueOptions={queueOptions.map((queue) => ({
            queueId: queue.queueId,
            queueTitle: queue.queueTitle,
            usersCount: queue.payload.users?.length ?? 0,
          }))}
          queuesLoading={queuesQuery.isLoading}
          queuesError={queuesQuery.isError}
          timezone={timezone}
          isPending={isPending}
          isDisabled={buildDisabled}
          onBuild={() => runQuery(selectedVisibleOperatorIds, false)}
          onDateChange={setSelectedDate}
          onDisplayFromChange={setDisplayFrom}
          onDisplayToChange={setDisplayTo}
          onWorkFromChange={setWorkFrom}
          onWorkToChange={setWorkTo}
          onQueueChange={setSelectedQueueId}
          onRetryQueues={() => queuesQuery.refetch()}
        />
      </div>

      <OperatorsSelectionPanel
        operators={filteredOperators}
        totalOperatorsCount={operatorOptions.length}
        selectedVisibleCount={selectedVisibleCount}
        totalSelectedCount={totalSelectedCount}
        selectedPreviewNames={selectedOperatorPreviewNames}
        selectedOperatorIds={selectedVisibleOperatorIds}
        searchText={searchText}
        isExpanded={operatorsExpanded}
        columnCount={operatorGridColumns}
        controlsId={operatorsPanelId}
        queueLabel={queueLabel}
        hasNoOperatorsInQueue={currentQueueIsEmpty}
        onSearchChange={setSearchText}
        onToggleExpanded={() => setOperatorsExpanded((current) => !current)}
        onSelectVisible={selectAllVisible}
        onClearVisible={clearVisible}
        onToggleOperator={(operatorId, checked) => {
          const next = checked
            ? [...selectedOperatorIds, operatorId]
            : selectedOperatorIds.filter((item) => item !== operatorId);
          setSelectedOperatorIds([...new Set(next)].sort((a, b) => a - b));
        }}
        onSelectAnotherQueue={() => setSelectedQueueId("all")}
        onRetryOperators={() => operatorsQuery.refetch()}
      />

      {!accessToken && (
        <div className="error-box">
          Выполните вход для построения таймлайна.
        </div>
      )}
      {validationError && <div className="error-box">{validationError}</div>}

      {accessToken && (
        <div className="card timeline2-results-card">
          <div className="timeline2-legend-note">
            Обесцвеченная область — вне рабочего времени
          </div>

          <div className="timeline2-scroll">
            <div className="timeline2-content">
              <div
                className="timeline2-axis"
                data-testid="timeline-global-axis"
              >
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

              {isPending && selectedVisibleOperatorIds.length > 0 && (
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

              {!isPending &&
                selectedVisibleOperatorIds.length === 0 &&
                selectedQueueId === "all" && (
                  <div className="timeline2-empty">
                    Выберите операторов, чтобы построить таймлайн.
                  </div>
                )}

              {!isPending &&
                selectedVisibleOperatorIds.length === 0 &&
                selectedQueueId !== "all" &&
                !currentQueueIsEmpty && (
                  <div className="timeline2-empty">
                    Выберите хотя бы одного оператора из этой очереди.
                  </div>
                )}

              {!isPending &&
                selectedVisibleOperatorIds.length > 0 &&
                hasNoDataForToday && (
                  <div
                    className="timeline2-empty"
                    data-testid="timeline-empty-today"
                  >
                    За выбранный период данных нет.
                  </div>
                )}

              {!isPending &&
                selectedVisibleOperatorIds.length > 0 &&
                !hasNoDataForToday && (
                  <div
                    className="timeline2-rows"
                    data-testid="timeline-rows-list"
                  >
                    {selectedVisibleOperators.map((operator) => {
                      const row = resultByOperatorId.get(operator.operatorId);
                      const presentation = row?.presentation ?? [];
                      const positioned = computeTrackSegments(
                        presentation,
                        timelineWindow.fromMs,
                        timelineWindow.toMs,
                      );
                      const hasNoData = row?.ok && positioned.length === 0;

                      return (
                        <div
                          key={operator.operatorId}
                          className="timeline2-row"
                          data-testid="timeline-row"
                        >
                          <div className="timeline2-row-meta">
                            <strong>
                              {operator.fullName?.trim() ||
                                `Оператор #${operator.operatorId}`}
                            </strong>
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
                                <span>
                                  {row.error || "Ошибка загрузки таймлайна"}
                                </span>
                                <button
                                  type="button"
                                  className="ghost"
                                  onClick={() =>
                                    runQuery([operator.operatorId], true)
                                  }
                                >
                                  Повторить
                                </button>
                              </div>
                            )}

                            {row?.ok && (
                              <div
                                className="timeline2-track"
                                data-testid="timeline-track"
                                style={{
                                  ["--overlay-before" as string]: `${workingOverlay.beforePct}%`,
                                  ["--overlay-after" as string]: `${workingOverlay.afterPct}%`,
                                }}
                              >
                                {hasNoData && (
                                  <div className="timeline2-track-no-data">
                                    Нет данных о статусах за выбранный период
                                  </div>
                                )}

                                {!hasNoData &&
                                  positioned.map((segment) => {
                                    const segmentColor = statusColor(
                                      statusTypes,
                                      segment.status,
                                      segment.isSystem,
                                    );
                                    const title = statusTitle(
                                      statusTypes,
                                      segment.status,
                                    );
                                    const hovered =
                                      tooltip?.segmentKey === segment.key;
                                    const dimmed =
                                      tooltip?.operatorId ===
                                        operator.operatorId &&
                                      tooltip.segmentKey !== segment.key;

                                    return (
                                      <button
                                        key={segment.key}
                                        type="button"
                                        className={`timeline2-segment ${hovered ? "is-hovered" : ""} ${
                                          dimmed ? "is-dimmed" : ""
                                        }`}
                                        data-testid="timeline-segment"
                                        data-status={segment.status}
                                        style={{
                                          left: `${segment.leftPct}%`,
                                          width: `${segment.widthPct}%`,
                                          backgroundColor: segmentColor,
                                        }}
                                        onMouseEnter={(event) =>
                                          onSegmentHover(
                                            event,
                                            operator.operatorId,
                                            operator.fullName?.trim() ||
                                              `Оператор #${operator.operatorId}`,
                                            operator.timezone,
                                            segment,
                                            segment.key,
                                          )
                                        }
                                        onMouseMove={onSegmentMove}
                                        onMouseLeave={() =>
                                          onSegmentLeave(segment.key)
                                        }
                                        onFocus={(event) =>
                                          onSegmentHover(
                                            event,
                                            operator.operatorId,
                                            operator.fullName?.trim() ||
                                              `Оператор #${operator.operatorId}`,
                                            operator.timezone,
                                            segment,
                                            segment.key,
                                          )
                                        }
                                        onBlur={() =>
                                          onSegmentLeave(segment.key)
                                        }
                                        aria-label={`${title}: ${formatDuration(segment.durationSec)}`}
                                      />
                                    );
                                  })}

                                {workingOverlay.enabled && (
                                  <>
                                    {workingOverlay.beforePct > 0 && (
                                      <div
                                        className="timeline2-work-overlay timeline2-work-overlay-before"
                                        data-testid="timeline-working-overlay-before"
                                        style={{
                                          width: `${workingOverlay.beforePct}%`,
                                        }}
                                      />
                                    )}
                                    {workingOverlay.afterPct > 0 && (
                                      <div
                                        className="timeline2-work-overlay timeline2-work-overlay-after"
                                        data-testid="timeline-working-overlay-after"
                                        style={{
                                          width: `${workingOverlay.afterPct}%`,
                                        }}
                                      />
                                    )}
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
            </div>
          </div>
        </div>
      )}

      {tooltip && (
        <div
          className="timeline2-tooltip"
          role="tooltip"
          style={{
            left: Math.min(globalThis.window.innerWidth - 310, tooltip.x + 14),
            top: Math.min(globalThis.window.innerHeight - 180, tooltip.y + 16),
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
            {formatLocalTimeFromMs(
              tooltip.segment.startMs,
              timezone.backendTimezone,
              windowSpansMultipleDates,
            )}{" "}
            —{" "}
            {formatLocalTimeFromMs(
              tooltip.segment.endMs,
              timezone.backendTimezone,
              windowSpansMultipleDates,
            )}
          </div>
          <div className="timeline2-tooltip-duration">
            {formatDuration(tooltip.segment.durationSec)}
          </div>
          <div className="timeline2-tooltip-description">
            {statusDescription(statusTypes, tooltip.segment.status)}
          </div>
          {tooltip.operatorTimezone && (
            <div className="timeline2-tooltip-zone">
              Исходный timezone оператора: {tooltip.operatorTimezone}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
