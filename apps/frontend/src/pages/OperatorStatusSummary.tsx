import { useMemo, useState } from "react";
import { normalizeStatusColor } from "./timeline-utils";

export type StatusInterval = {
  status: string;
  durationSec: number;
  isSystem?: boolean;
};

export type StatusConfig = {
  title: string;
  color?: string | null;
  description?: string | null;
};

type StatusSummaryItem = {
  status: string;
  title: string;
  color: string;
  durationSec: number;
  percentOfTotal: number;
};

const FALLBACK_BAR_COLOR = "#94A3B8";
const CHART_SIZE = 240;
const OUTER_RADIUS = 94;
const INNER_RADIUS = 60;

function padClock(value: number): string {
  return String(Math.max(0, Math.floor(value))).padStart(2, "0");
}

function formatDurationClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;

  return `${padClock(hours)}:${padClock(minutes)}:${padClock(remainder)}`;
}

function formatDurationHuman(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;

  if (hours > 0) {
    return `${hours} ч ${minutes.toString().padStart(2, "0")} мин`;
  }

  if (minutes > 0) {
    return `${minutes} мин ${remainder.toString().padStart(2, "0")} сек`;
  }

  return `${remainder} сек`;
}

function polarToCartesian(
  centerX: number,
  centerY: number,
  radius: number,
  angleInDegrees: number,
) {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180.0;
  return {
    x: centerX + radius * Math.cos(angleInRadians),
    y: centerY + radius * Math.sin(angleInRadians),
  };
}

function describeArc(
  centerX: number,
  centerY: number,
  outerRadius: number,
  innerRadius: number,
  startAngle: number,
  endAngle: number,
) {
  const outerStart = polarToCartesian(centerX, centerY, outerRadius, endAngle);
  const outerEnd = polarToCartesian(centerX, centerY, outerRadius, startAngle);
  const innerStart = polarToCartesian(centerX, centerY, innerRadius, startAngle);
  const innerEnd = polarToCartesian(centerX, centerY, innerRadius, endAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? 0 : 1;

  return [
    "M",
    outerStart.x,
    outerStart.y,
    "A",
    outerRadius,
    outerRadius,
    0,
    largeArcFlag,
    0,
    outerEnd.x,
    outerEnd.y,
    "L",
    innerStart.x,
    innerStart.y,
    "A",
    innerRadius,
    innerRadius,
    0,
    largeArcFlag,
    1,
    innerEnd.x,
    innerEnd.y,
    "Z",
  ].join(" ");
}

export function OperatorStatusSummary({
  intervals,
  statusesMap,
}: {
  intervals: StatusInterval[];
  statusesMap: Record<string, StatusConfig>;
}) {
  const [hoveredStatus, setHoveredStatus] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"bars" | "pie">("bars");

  const items = useMemo<StatusSummaryItem[]>(() => {
    const totals = new Map<string, number>();

    for (const interval of intervals) {
      if (!interval.status) {
        continue;
      }

      const current = totals.get(interval.status) ?? 0;
      totals.set(interval.status, current + Math.max(0, interval.durationSec || 0));
    }

    const totalDurationSec = Array.from(totals.values()).reduce(
      (sum, duration) => sum + duration,
      0,
    );

    return Array.from(totals.entries())
      .map(([status, durationSec]) => {
        const config = statusesMap[status] ?? { title: status, color: null };
        return {
          status,
          title: config.title,
          color: normalizeStatusColor(config.color ?? null) ?? FALLBACK_BAR_COLOR,
          durationSec,
          percentOfTotal:
            totalDurationSec > 0 ? (durationSec / totalDurationSec) * 100 : 0,
        };
      })
      .sort((left, right) => {
        if (right.durationSec !== left.durationSec) {
          return right.durationSec - left.durationSec;
        }

        return left.title.localeCompare(right.title, "ru");
      });
  }, [intervals, statusesMap]);

  const maxDurationSec = items.reduce(
    (max, item) => Math.max(max, item.durationSec),
    0,
  );
  const hoveredItem = items.find((item) => item.status === hoveredStatus) ?? null;
  const totalDurationSec = items.reduce((sum, item) => sum + item.durationSec, 0);

  if (intervals.length === 0 || items.length === 0) {
    return (
      <div className="operator-status-summary-empty">
        Информация о статусе отсутствует
      </div>
    );
  }

  let runningAngle = 0;
  const pieSlices = items.map((item) => {
    const sliceAngle = totalDurationSec > 0 ? (item.durationSec / totalDurationSec) * 360 : 0;
    const startAngle = runningAngle;
    const endAngle = runningAngle + sliceAngle;
    runningAngle = endAngle;
    return {
      ...item,
      startAngle,
      endAngle,
      path: describeArc(
        CHART_SIZE / 2,
        CHART_SIZE / 2,
        OUTER_RADIUS,
        INNER_RADIUS,
        startAngle,
        endAngle,
      ),
    };
  });

  return (
    <div className="operator-status-summary">
      <div className="operator-status-summary-head">
        <div>
          <strong>Детализация статусов</strong>
          <p>Суммарное время по каждому статусу за выбранный период.</p>
        </div>
        <div className="operator-status-summary-switcher" role="tablist" aria-label="Тип диаграммы">
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === "bars"}
            className={`operator-status-summary-switcher-btn ${viewMode === "bars" ? "is-active" : ""}`}
            onClick={() => setViewMode("bars")}
          >
            Столбцы
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === "pie"}
            className={`operator-status-summary-switcher-btn ${viewMode === "pie" ? "is-active" : ""}`}
            onClick={() => setViewMode("pie")}
          >
            Круговая
          </button>
        </div>
      </div>

      {hoveredItem ? (
        <div className="operator-status-summary-tooltip is-visible">
          <span className="operator-status-summary-tooltip-dot" />
          <span>
            {hoveredItem.title}: {formatDurationHuman(hoveredItem.durationSec)} ({hoveredItem.percentOfTotal.toFixed(1)}%)
          </span>
        </div>
      ) : (
        <div className="operator-status-summary-hint">
          Наведите на столбец или сектор для деталей
        </div>
      )}

      {viewMode === "bars" ? (
        <div className="operator-status-summary-bars-wrap">
          <div className="operator-status-summary-total" aria-label="Общее время">
            Общее время: {formatDurationClock(totalDurationSec)}
          </div>

          <div className="operator-status-summary-bars" role="list">
            {items.map((item) => {
              const heightPct =
                maxDurationSec > 0
                  ? Math.max(16, (item.durationSec / maxDurationSec) * 100)
                  : 16;

              return (
                <button
                  key={item.status}
                  type="button"
                  role="listitem"
                  className="operator-status-summary-bar"
                  onMouseEnter={() => setHoveredStatus(item.status)}
                  onFocus={() => setHoveredStatus(item.status)}
                  onMouseLeave={() => setHoveredStatus(null)}
                  onBlur={() => setHoveredStatus(null)}
                  onClick={(event) => event.stopPropagation()}
                  title={`${item.title}: ${formatDurationHuman(item.durationSec)} (${item.percentOfTotal.toFixed(1)}%)`}
                  aria-label={`${item.title}: ${formatDurationHuman(item.durationSec)} (${item.percentOfTotal.toFixed(1)}%)`}
                >
                  <div className="operator-status-summary-bar-value">
                    {formatDurationClock(item.durationSec)}
                  </div>
                  <div className="operator-status-summary-bar-rail">
                    <div
                      className="operator-status-summary-bar-fill"
                      style={{
                        height: `${heightPct}%`,
                        backgroundColor: item.color,
                      }}
                    />
                  </div>
                  <div className="operator-status-summary-bar-title">
                    {item.title}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="operator-status-summary-pie-layout">
          <div className="operator-status-summary-pie-wrap">
            <svg
              className="operator-status-summary-pie"
              viewBox={`0 0 ${CHART_SIZE} ${CHART_SIZE}`}
              role="img"
              aria-label="Круговая диаграмма статусов"
            >
              <circle
                cx={CHART_SIZE / 2}
                cy={CHART_SIZE / 2}
                r={OUTER_RADIUS}
                className="operator-status-summary-pie-base"
              />
              {pieSlices.map((item) => (
                <path
                  key={item.status}
                  d={item.path}
                  fill={item.color}
                  onMouseEnter={() => setHoveredStatus(item.status)}
                  onMouseLeave={() => setHoveredStatus(null)}
                  onFocus={() => setHoveredStatus(item.status)}
                  onBlur={() => setHoveredStatus(null)}
                  tabIndex={0}
                  role="button"
                  aria-label={`${item.title}: ${formatDurationHuman(item.durationSec)} (${item.percentOfTotal.toFixed(1)}%)`}
                  className="operator-status-summary-pie-slice"
                />
              ))}
              <circle
                cx={CHART_SIZE / 2}
                cy={CHART_SIZE / 2}
                r={INNER_RADIUS}
                className="operator-status-summary-pie-hole"
              />
              <text
                x="50%"
                y="48%"
                textAnchor="middle"
                className="operator-status-summary-pie-total"
              >
                {formatDurationClock(totalDurationSec)}
              </text>
              <text
                x="50%"
                y="57%"
                textAnchor="middle"
                className="operator-status-summary-pie-caption"
              >
                Общее время
              </text>
            </svg>
          </div>

          <div className="operator-status-summary-legend">
            {items.map((item) => (
              <button
                key={item.status}
                type="button"
                className="operator-status-summary-legend-item"
                onMouseEnter={() => setHoveredStatus(item.status)}
                onFocus={() => setHoveredStatus(item.status)}
                onMouseLeave={() => setHoveredStatus(null)}
                onBlur={() => setHoveredStatus(null)}
                onClick={(event) => event.stopPropagation()}
                title={`${item.title}: ${formatDurationHuman(item.durationSec)} (${item.percentOfTotal.toFixed(1)}%)`}
                aria-label={`${item.title}: ${formatDurationHuman(item.durationSec)} (${item.percentOfTotal.toFixed(1)}%)`}
              >
                <span
                  className="operator-status-summary-legend-dot"
                  style={{ backgroundColor: item.color }}
                />
                <span className="operator-status-summary-legend-text">
                  <strong>{item.title}</strong>
                  <small>
                    {formatDurationHuman(item.durationSec)} · {item.percentOfTotal.toFixed(1)}%
                  </small>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="operator-status-summary-note">
        Диаграмма показывает суммарные интервалы по статусам, отсортированные от
        самого длительного к самому короткому.
      </div>
    </div>
  );
}
