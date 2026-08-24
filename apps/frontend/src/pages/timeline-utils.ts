export type TimelineSegmentPresentation = {
  status: string;
  start: string;
  end: string;
  durationSec: number;
  isSystem?: boolean;
  reason?: string;
  startLocal: string;
  endLocal: string;
  startDateKey: string;
  endDateKey: string;
  startOffsetMinutes: number;
  endOffsetMinutes: number;
  crossesLocalDateBoundary: boolean;
};

export type TimelineTrackSegment = {
  key: string;
  status: string;
  startMs: number;
  endMs: number;
  leftPct: number;
  widthPct: number;
  durationSec: number;
  isSystem?: boolean;
  source: TimelineSegmentPresentation;
};

export type TimelineTick = {
  label: string;
  leftPct: number;
};

export type WorkingHoursOverlay = {
  enabled: boolean;
  beforePct: number;
  afterPct: number;
};

export type TimezoneResolution = {
  backendTimezone: string;
  label: string;
  details: string;
  warning: string | null;
};

function parseDateParts(selectedDate: string): {
  year: number;
  month: number;
  day: number;
} {
  const [year, month, day] = selectedDate
    .split("-")
    .map((part) => Number(part));
  return { year, month, day };
}

function parseTimeParts(value: string): { hour: number; minute: number } {
  const [hour, minute] = value.split(":").map((part) => Number(part));
  return { hour: hour || 0, minute: minute || 0 };
}

function isValidIanaTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function parseOffsetMinutes(raw: string): number | null {
  const value = raw.trim().toUpperCase();
  const directHour = /^([+-]?\d{1,2})$/.exec(value);
  if (directHour) {
    const hours = Number(directHour[1]);
    if (Number.isFinite(hours) && Math.abs(hours) <= 14) {
      return hours * 60;
    }
  }

  const utcCompact = /^UTC([+-]?\d{1,2})$/.exec(value);
  if (utcCompact) {
    const hours = Number(utcCompact[1]);
    if (Number.isFinite(hours) && Math.abs(hours) <= 14) {
      return hours * 60;
    }
  }

  const offset = /^(?:UTC)?([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(value);
  if (!offset) {
    return null;
  }

  const sign = offset[1] === "-" ? -1 : 1;
  const hours = Number(offset[2]);
  const minutes = Number(offset[3] ?? "0");
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return null;
  }

  if (hours > 14 || minutes > 59) {
    return null;
  }

  return sign * (hours * 60 + minutes);
}

function offsetToLabel(offsetMinutes: number): string {
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  const hours = Math.floor(absolute / 60)
    .toString()
    .padStart(2, "0");
  const minutes = (absolute % 60).toString().padStart(2, "0");
  return `UTC${sign}${hours}:${minutes}`;
}

function resolveOffsetForTimezone(timezone: string, date: Date): number {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((item) => item.type === type)?.value ?? 0);

  const projectedUtcMs = Date.UTC(
    read("year"),
    read("month") - 1,
    read("day"),
    read("hour"),
    read("minute"),
    read("second"),
  );

  return Math.round((projectedUtcMs - date.getTime()) / 60000);
}

function zonedLocalToUtcMs(
  selectedDate: string,
  time: string,
  timezone: string,
): number {
  const { year, month, day } = parseDateParts(selectedDate);
  const { hour, minute } = parseTimeParts(time);
  const utcCandidateBase = Date.UTC(year, month - 1, day, hour, minute, 0, 0);

  if (!isValidIanaTimezone(timezone)) {
    return utcCandidateBase;
  }

  let guess = utcCandidateBase;
  for (let i = 0; i < 5; i += 1) {
    const offsetMinutes = resolveOffsetForTimezone(timezone, new Date(guess));
    const next = utcCandidateBase - offsetMinutes * 60_000;
    if (next === guess) {
      return next;
    }
    guess = next;
  }

  return guess;
}

function formatWithTimezone(ms: number, timezone: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(new Date(ms));
  const read = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((item) => item.type === type)?.value ?? "00";

  return `${read("year")}-${read("month")}-${read("day")} ${read("hour")}:${read("minute")}:${read("second")}`;
}

export function formatLocalTimeFromMs(
  ms: number,
  timezone: string,
  withDate: boolean,
): string {
  const value = formatWithTimezone(ms, timezone);
  const [datePart, timePart] = value.split(" ");
  if (withDate) {
    return `${datePart} ${timePart}`;
  }
  return timePart;
}

function normalizeOperatorTimezone(raw?: string | null): {
  backendTimezone: string;
  label: string;
  key: string;
} | null {
  if (!raw || !raw.trim()) {
    return null;
  }

  const value = raw.trim();
  if (isValidIanaTimezone(value)) {
    const offset = resolveOffsetForTimezone(value, new Date());
    return {
      backendTimezone: value,
      label: `${value} · ${offsetToLabel(offset)}`,
      key: `iana:${value}`,
    };
  }

  const offsetMinutes = parseOffsetMinutes(value);
  if (offsetMinutes === null) {
    return null;
  }

  const absHours = Math.floor(Math.abs(offsetMinutes) / 60);
  const absMinutes = Math.abs(offsetMinutes) % 60;
  let backendTimezone = "UTC";

  if (absMinutes === 0) {
    if (offsetMinutes === 0) {
      backendTimezone = "UTC";
    } else {
      const sign = offsetMinutes > 0 ? "-" : "+";
      backendTimezone = `Etc/GMT${sign}${absHours}`;
    }
  }

  return {
    backendTimezone,
    label: offsetToLabel(offsetMinutes),
    key: `offset:${offsetMinutes}`,
  };
}

export function resolveTimelineTimezone(
  operators: Array<{ operatorId: number; timezone?: string | null }>,
  selectedOperatorIds: number[],
): TimezoneResolution {
  const selectedSet = new Set(selectedOperatorIds);
  const source =
    selectedSet.size > 0
      ? operators.filter((item) => selectedSet.has(item.operatorId))
      : operators;

  const resolved = source
    .map((item) => normalizeOperatorTimezone(item.timezone))
    .filter((item): item is NonNullable<typeof item> => !!item);

  if (resolved.length === 0) {
    const browserTimezone =
      Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const normalized = normalizeOperatorTimezone(browserTimezone);
    if (normalized) {
      return {
        backendTimezone: normalized.backendTimezone,
        label: normalized.label,
        details: "Автоматически определено по часовому поясу браузера",
        warning: null,
      };
    }

    return {
      backendTimezone: "UTC",
      label: "UTC+00:00",
      details: "Используется UTC как безопасное значение по умолчанию",
      warning: null,
    };
  }

  const unique = new Map<string, { backendTimezone: string; label: string }>();
  for (const item of resolved) {
    unique.set(item.key, {
      backendTimezone: item.backendTimezone,
      label: item.label,
    });
  }

  const entries = [...unique.values()];
  if (entries.length === 1) {
    return {
      backendTimezone: entries[0].backendTimezone,
      label: entries[0].label,
      details: "Автоматически определено по выбранным операторам",
      warning: null,
    };
  }

  return {
    backendTimezone: entries[0].backendTimezone,
    label: entries[0].label,
    details: "Используется единый часовой пояс для сопоставимости таймлайнов",
    warning: `У операторов разные часовые пояса. Таймлайн показан в ${entries[0].label}.`,
  };
}

export function normalizeStatusColor(raw?: string | null): string | null {
  if (!raw) {
    return null;
  }

  const value = raw.trim();
  if (!value) {
    return null;
  }

  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value)) {
    return value;
  }

  if (/^([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value)) {
    return `#${value}`;
  }

  if (/^rgba?\(([^)]+)\)$/.test(value)) {
    return value;
  }

  return null;
}

export function fallbackStatusColor(status: string): string {
  const palette = [
    "#5FCDE5",
    "#7ACC90",
    "#367BF5",
    "#F3AA18",
    "#EA7E75",
    "#8B55FF",
    "#78909C",
  ];
  const seed = Array.from(status).reduce(
    (acc, char) => acc + char.charCodeAt(0),
    0,
  );
  return palette[seed % palette.length];
}

export function buildUtcWindowIso(
  selectedDate: string,
  fromTime: string,
  toTime: string,
  timezone = "UTC",
): {
  fromIso: string;
  toIso: string;
  fromMs: number;
  toMs: number;
} {
  const fromMs = zonedLocalToUtcMs(selectedDate, fromTime, timezone);

  let toMs = zonedLocalToUtcMs(selectedDate, toTime, timezone);
  if (toMs <= fromMs) {
    toMs += 24 * 60 * 60 * 1000;
  }

  return {
    fromIso: new Date(fromMs).toISOString(),
    toIso: new Date(toMs).toISOString(),
    fromMs,
    toMs,
  };
}

export function computeTrackSegments(
  segments: TimelineSegmentPresentation[],
  timelineStartMs: number,
  timelineEndMs: number,
): TimelineTrackSegment[] {
  const duration = timelineEndMs - timelineStartMs;
  if (duration <= 0) {
    return [];
  }

  const positioned: TimelineTrackSegment[] = [];

  segments.forEach((segment, index) => {
    const startMs = new Date(segment.start).getTime();
    const endMs = new Date(segment.end).getTime();
    const visibleStart = Math.max(startMs, timelineStartMs);
    const visibleEnd = Math.min(endMs, timelineEndMs);

    if (visibleEnd <= visibleStart) {
      return;
    }

    const leftPct = ((visibleStart - timelineStartMs) / duration) * 100;
    const widthPct = ((visibleEnd - visibleStart) / duration) * 100;

    positioned.push({
      key: `${segment.status}-${segment.start}-${segment.end}-${index}`,
      status: segment.status,
      startMs: visibleStart,
      endMs: visibleEnd,
      leftPct,
      widthPct: Math.max(widthPct, 0.08),
      durationSec: Math.max(0, Math.floor((visibleEnd - visibleStart) / 1000)),
      isSystem: segment.isSystem,
      source: segment,
    });
  });

  return positioned.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
}

export function computeAxisTicks(
  timelineStartMs: number,
  timelineEndMs: number,
): TimelineTick[] {
  const durationMinutes = Math.max(
    1,
    Math.floor((timelineEndMs - timelineStartMs) / 60000),
  );

  let stepMinutes = 120;
  if (durationMinutes <= 120) stepMinutes = 15;
  else if (durationMinutes <= 360) stepMinutes = 30;
  else if (durationMinutes <= 720) stepMinutes = 60;
  else if (durationMinutes <= 1440) stepMinutes = 120;
  else if (durationMinutes <= 2880) stepMinutes = 240;
  else stepMinutes = 360;

  const stepMs = stepMinutes * 60 * 1000;
  const firstTickMs = Math.ceil(timelineStartMs / stepMs) * stepMs;
  const ticks: TimelineTick[] = [];

  for (let value = firstTickMs; value <= timelineEndMs; value += stepMs) {
    const leftPct =
      ((value - timelineStartMs) / (timelineEndMs - timelineStartMs)) * 100;
    const date = new Date(value);
    const label = `${date.getUTCHours().toString().padStart(2, "0")}:${date
      .getUTCMinutes()
      .toString()
      .padStart(2, "0")}`;
    ticks.push({ label, leftPct });
  }

  if (ticks.length < 2) {
    ticks.push(
      { label: "00:00", leftPct: 0 },
      { label: "23:59", leftPct: 100 },
    );
  }

  return ticks;
}

export function computeAxisTicksForTimezone(
  timelineStartMs: number,
  timelineEndMs: number,
  timezone: string,
): TimelineTick[] {
  const ticks = computeAxisTicks(timelineStartMs, timelineEndMs);
  return ticks.map((tick) => {
    const ms =
      timelineStartMs +
      ((timelineEndMs - timelineStartMs) * tick.leftPct) / 100;
    const formatted = formatLocalTimeFromMs(ms, timezone, false);
    return {
      ...tick,
      label: formatted.slice(0, 5),
    };
  });
}

export function computeWorkingHoursOverlay(
  selectedDate: string,
  displayFrom: string,
  displayTo: string,
  workFrom: string,
  workTo: string,
  timezone = "UTC",
): WorkingHoursOverlay {
  const display = buildUtcWindowIso(
    selectedDate,
    displayFrom,
    displayTo,
    timezone,
  );
  const work = buildUtcWindowIso(selectedDate, workFrom, workTo, timezone);

  const total = display.toMs - display.fromMs;
  if (total <= 0) {
    return { enabled: false, beforePct: 0, afterPct: 0 };
  }

  const clampedWorkStart = Math.max(
    display.fromMs,
    Math.min(display.toMs, work.fromMs),
  );
  const clampedWorkEnd = Math.max(
    display.fromMs,
    Math.min(display.toMs, work.toMs),
  );

  if (clampedWorkStart <= display.fromMs && clampedWorkEnd >= display.toMs) {
    return { enabled: false, beforePct: 0, afterPct: 0 };
  }

  const beforePct = Math.max(
    0,
    ((clampedWorkStart - display.fromMs) / total) * 100,
  );
  const afterPct = Math.max(0, ((display.toMs - clampedWorkEnd) / total) * 100);

  if (beforePct <= 0 && afterPct <= 0) {
    return { enabled: false, beforePct: 0, afterPct: 0 };
  }

  return {
    enabled: true,
    beforePct,
    afterPct,
  };
}
