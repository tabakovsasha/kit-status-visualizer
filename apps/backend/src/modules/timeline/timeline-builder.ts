export type RawStatusEvent = {
  id: number;
  user_id: number;
  status: string;
  status_start_date: string;
  status_end_date: string;
  next_status?: string | null;
  duration?: number;
};

export type TimelineSegment = {
  status: string;
  start: string;
  end: string;
  durationSec: number;
  isSystem?: boolean;
  reason?: string;
};

export type StatusAggregate = {
  status: string;
  durationSec: number;
  percentage: number;
};

export type TimelineAggregation = {
  windowDurationSec: number;
  measurableDurationSec: number;
  noDataDurationSec: number;
  byStatus: StatusAggregate[];
};

export type TimelineSegmentPresentation = TimelineSegment & {
  startLocal: string;
  endLocal: string;
  startDateKey: string;
  endDateKey: string;
  startOffsetMinutes: number;
  endOffsetMinutes: number;
  crossesLocalDateBoundary: boolean;
};

function parseMs(value: string): number {
  return new Date(value.replace(' ', 'T') + 'Z').getTime();
}

function resolveTimezone(timezone: string): string {
  const candidate = timezone?.trim() || 'UTC';
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: candidate }).format(
      new Date(),
    );
    return candidate;
  } catch {
    return 'UTC';
  }
}

function getZonedParts(iso: string, timezone: string) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(new Date(iso));
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const value = parts.find((p) => p.type === type)?.value;
    return Number(value ?? 0);
  };

  const year = read('year');
  const month = read('month');
  const day = read('day');
  const hour = read('hour');
  const minute = read('minute');
  const second = read('second');

  const actualMs = new Date(iso).getTime();
  const projectedUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const offsetMinutes = Math.round((projectedUtcMs - actualMs) / 60000);

  const two = (v: number) => String(v).padStart(2, '0');
  return {
    localDateTime: `${year}-${two(month)}-${two(day)} ${two(hour)}:${two(minute)}:${two(second)}`,
    localDateKey: `${year}-${two(month)}-${two(day)}`,
    offsetMinutes,
  };
}

export function buildTimeline(
  events: RawStatusEvent[],
  fromIso: string,
  toIso: string,
): TimelineSegment[] {
  const fromMs = new Date(fromIso).getTime();
  const toMs = new Date(toIso).getTime();

  const sorted = [...events]
    .filter((e) => e.status_start_date && e.status_end_date)
    .sort(
      (a, b) => parseMs(a.status_start_date) - parseMs(b.status_start_date),
    );

  const result: TimelineSegment[] = [];

  for (const item of sorted) {
    const startMs = Math.max(fromMs, parseMs(item.status_start_date));
    const endMs = Math.min(toMs, parseMs(item.status_end_date));
    if (endMs <= startMs) {
      continue;
    }

    const segment: TimelineSegment = {
      status: item.status,
      start: new Date(startMs).toISOString(),
      end: new Date(endMs).toISOString(),
      durationSec: Math.max(0, Math.floor((endMs - startMs) / 1000)),
    };

    const prev = result[result.length - 1];
    if (prev && new Date(prev.end).getTime() > startMs) {
      prev.end = new Date(startMs).toISOString();
      prev.durationSec = Math.max(
        0,
        Math.floor(
          (new Date(prev.end).getTime() - new Date(prev.start).getTime()) /
            1000,
        ),
      );
    }

    result.push(segment);
  }

  if (result.length === 0) {
    return [
      {
        status: 'NO_DATA',
        start: new Date(fromMs).toISOString(),
        end: new Date(toMs).toISOString(),
        durationSec: Math.max(0, Math.floor((toMs - fromMs) / 1000)),
        isSystem: true,
        reason: 'No status events in selected range',
      },
    ];
  }

  const withGaps: TimelineSegment[] = [];
  let cursor = fromMs;
  for (const segment of result) {
    const segmentStartMs = new Date(segment.start).getTime();
    if (segmentStartMs > cursor) {
      withGaps.push({
        status: 'NO_DATA',
        start: new Date(cursor).toISOString(),
        end: new Date(segmentStartMs).toISOString(),
        durationSec: Math.floor((segmentStartMs - cursor) / 1000),
        isSystem: true,
        reason: 'Gap detected from source data',
      });
    }
    withGaps.push(segment);
    cursor = new Date(segment.end).getTime();
  }

  if (cursor < toMs) {
    withGaps.push({
      status: 'NO_DATA',
      start: new Date(cursor).toISOString(),
      end: new Date(toMs).toISOString(),
      durationSec: Math.floor((toMs - cursor) / 1000),
      isSystem: true,
      reason: 'No terminal status event for selected range end',
    });
  }

  return withGaps;
}

export function aggregateTimeline(
  timeline: TimelineSegment[],
  fromIso: string,
  toIso: string,
): TimelineAggregation {
  const fromMs = new Date(fromIso).getTime();
  const toMs = new Date(toIso).getTime();
  const windowDurationSec = Math.max(0, Math.floor((toMs - fromMs) / 1000));

  let noDataDurationSec = 0;
  const durationByStatus = new Map<string, number>();

  for (const segment of timeline) {
    const durationSec = Math.max(0, Math.floor(segment.durationSec));
    if (durationSec <= 0) {
      continue;
    }

    if (segment.isSystem && segment.status === 'NO_DATA') {
      noDataDurationSec += durationSec;
      continue;
    }

    if (segment.isSystem) {
      continue;
    }

    const prev = durationByStatus.get(segment.status) ?? 0;
    durationByStatus.set(segment.status, prev + durationSec);
  }

  const measurableDurationSec = [...durationByStatus.values()].reduce(
    (acc, value) => acc + value,
    0,
  );

  const byStatus = [...durationByStatus.entries()]
    .map(([status, durationSec]) => {
      const percentage =
        measurableDurationSec > 0
          ? Number(((durationSec / measurableDurationSec) * 100).toFixed(4))
          : 0;
      return {
        status,
        durationSec,
        percentage,
      };
    })
    .sort(
      (a, b) =>
        b.durationSec - a.durationSec || a.status.localeCompare(b.status),
    );

  return {
    windowDurationSec,
    measurableDurationSec,
    noDataDurationSec,
    byStatus,
  };
}

export function presentTimelineForTimezone(
  timeline: TimelineSegment[],
  timezone: string,
): TimelineSegmentPresentation[] {
  const safeTimezone = resolveTimezone(timezone);

  return timeline.map((segment) => {
    const start = getZonedParts(segment.start, safeTimezone);
    const end = getZonedParts(segment.end, safeTimezone);

    return {
      ...segment,
      startLocal: start.localDateTime,
      endLocal: end.localDateTime,
      startDateKey: start.localDateKey,
      endDateKey: end.localDateKey,
      startOffsetMinutes: start.offsetMinutes,
      endOffsetMinutes: end.offsetMinutes,
      crossesLocalDateBoundary: start.localDateKey !== end.localDateKey,
    };
  });
}
