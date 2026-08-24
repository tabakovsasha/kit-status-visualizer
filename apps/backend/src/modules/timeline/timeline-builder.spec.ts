import {
  aggregateTimeline,
  buildTimeline,
  presentTimelineForTimezone,
} from './timeline-builder';

describe('timeline builder', () => {
  it('fills gap with NO_DATA', () => {
    const from = '2026-07-14T00:00:00.000Z';
    const to = '2026-07-14T01:00:00.000Z';

    const result = buildTimeline(
      [
        {
          id: 1,
          user_id: 10,
          status: 'READY',
          status_start_date: '2026-07-14 00:10:00',
          status_end_date: '2026-07-14 00:20:00',
          next_status: 'ONLINE',
          duration: 600,
        },
      ],
      from,
      to,
    );

    expect(result[0].status).toBe('NO_DATA');
    expect(result.some((x) => x.status === 'READY')).toBe(true);
  });

  it('returns all NO_DATA when no events', () => {
    const from = '2026-07-14T00:00:00.000Z';
    const to = '2026-07-14T01:00:00.000Z';

    const result = buildTimeline([], from, to);

    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('NO_DATA');
  });

  it('aggregates durations and percentages by measurable statuses', () => {
    const from = '2026-07-14T00:00:00.000Z';
    const to = '2026-07-14T01:00:00.000Z';

    const timeline = buildTimeline(
      [
        {
          id: 1,
          user_id: 10,
          status: 'READY',
          status_start_date: '2026-07-14 00:00:00',
          status_end_date: '2026-07-14 00:15:00',
          next_status: 'BUSY',
          duration: 900,
        },
        {
          id: 2,
          user_id: 10,
          status: 'BUSY',
          status_start_date: '2026-07-14 00:15:00',
          status_end_date: '2026-07-14 00:30:00',
          next_status: 'READY',
          duration: 900,
        },
        {
          id: 3,
          user_id: 10,
          status: 'READY',
          status_start_date: '2026-07-14 00:30:00',
          status_end_date: '2026-07-14 00:45:00',
          next_status: 'OFFLINE',
          duration: 900,
        },
      ],
      from,
      to,
    );

    const aggregates = aggregateTimeline(timeline, from, to);

    expect(aggregates.windowDurationSec).toBe(3600);
    expect(aggregates.measurableDurationSec).toBe(2700);
    expect(aggregates.noDataDurationSec).toBe(900);
    expect(aggregates.byStatus).toEqual([
      {
        status: 'READY',
        durationSec: 1800,
        percentage: 66.6667,
      },
      {
        status: 'BUSY',
        durationSec: 900,
        percentage: 33.3333,
      },
    ]);
  });

  it('returns zero percentages when measurable duration is empty', () => {
    const from = '2026-07-14T00:00:00.000Z';
    const to = '2026-07-14T01:00:00.000Z';
    const timeline = buildTimeline([], from, to);

    const aggregates = aggregateTimeline(timeline, from, to);

    expect(aggregates.windowDurationSec).toBe(3600);
    expect(aggregates.measurableDurationSec).toBe(0);
    expect(aggregates.noDataDurationSec).toBe(3600);
    expect(aggregates.byStatus).toEqual([]);
  });

  it('uses overlap-trimmed timeline segments for aggregation policy', () => {
    const from = '2026-07-14T00:00:00.000Z';
    const to = '2026-07-14T00:30:00.000Z';

    const timeline = buildTimeline(
      [
        {
          id: 1,
          user_id: 10,
          status: 'READY',
          status_start_date: '2026-07-14 00:00:00',
          status_end_date: '2026-07-14 00:20:00',
          next_status: 'BUSY',
          duration: 1200,
        },
        {
          id: 2,
          user_id: 10,
          status: 'BUSY',
          status_start_date: '2026-07-14 00:10:00',
          status_end_date: '2026-07-14 00:25:00',
          next_status: 'OFFLINE',
          duration: 900,
        },
      ],
      from,
      to,
    );

    const aggregates = aggregateTimeline(timeline, from, to);

    expect(aggregates.windowDurationSec).toBe(1800);
    expect(aggregates.measurableDurationSec).toBe(1500);
    expect(aggregates.noDataDurationSec).toBe(300);
    expect(aggregates.byStatus).toEqual([
      {
        status: 'BUSY',
        durationSec: 900,
        percentage: 60,
      },
      {
        status: 'READY',
        durationSec: 600,
        percentage: 40,
      },
    ]);
  });

  it('marks local day boundary crossing for rendering labels', () => {
    const timeline = [
      {
        status: 'READY',
        start: '2026-07-14T18:30:00.000Z',
        end: '2026-07-14T20:00:00.000Z',
        durationSec: 5400,
      },
    ];

    const presented = presentTimelineForTimezone(timeline, 'Asia/Qyzylorda');

    expect(presented[0].startLocal).toBe('2026-07-14 23:30:00');
    expect(presented[0].endLocal).toBe('2026-07-15 01:00:00');
    expect(presented[0].startDateKey).toBe('2026-07-14');
    expect(presented[0].endDateKey).toBe('2026-07-15');
    expect(presented[0].crossesLocalDateBoundary).toBe(true);
  });

  it('keeps UTC duration while labels reflect DST spring forward jump', () => {
    const timeline = [
      {
        status: 'READY',
        start: '2026-03-29T00:30:00.000Z',
        end: '2026-03-29T02:30:00.000Z',
        durationSec: 7200,
      },
    ];

    const presented = presentTimelineForTimezone(timeline, 'Europe/Berlin');

    expect(presented[0].startLocal).toBe('2026-03-29 01:30:00');
    expect(presented[0].endLocal).toBe('2026-03-29 04:30:00');
    expect(presented[0].startOffsetMinutes).toBe(60);
    expect(presented[0].endOffsetMinutes).toBe(120);
    expect(presented[0].durationSec).toBe(7200);
  });

  it('keeps UTC duration while labels reflect DST fall back offset shift', () => {
    const timeline = [
      {
        status: 'READY',
        start: '2026-10-25T00:30:00.000Z',
        end: '2026-10-25T02:30:00.000Z',
        durationSec: 7200,
      },
    ];

    const presented = presentTimelineForTimezone(timeline, 'Europe/Berlin');

    expect(presented[0].startLocal).toBe('2026-10-25 02:30:00');
    expect(presented[0].endLocal).toBe('2026-10-25 03:30:00');
    expect(presented[0].startOffsetMinutes).toBe(120);
    expect(presented[0].endOffsetMinutes).toBe(60);
    expect(presented[0].durationSec).toBe(7200);
  });

  it('falls back to UTC labels when timezone is invalid', () => {
    const timeline = [
      {
        status: 'READY',
        start: '2026-07-14T12:00:00.000Z',
        end: '2026-07-14T13:00:00.000Z',
        durationSec: 3600,
      },
    ];

    const presented = presentTimelineForTimezone(timeline, 'Invalid/Timezone');

    expect(presented[0].startLocal).toBe('2026-07-14 12:00:00');
    expect(presented[0].endLocal).toBe('2026-07-14 13:00:00');
    expect(presented[0].startOffsetMinutes).toBe(0);
    expect(presented[0].endOffsetMinutes).toBe(0);
  });
});
