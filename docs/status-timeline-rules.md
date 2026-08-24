# Status Timeline Rules

## Input model from examples

Each status history row contains:
- `id`
- `user_id`
- `status`
- `status_start_date`
- `status_end_date`
- `next_status`
- `changed_by`
- `duration`

No explicit `old_status` field was observed.

## Normalization rules

1. Parse all upstream timestamps as naive upstream-zone datetime and convert to UTC instants.
2. Reject rows with unparseable timestamps as invalid events (count and report).
3. Keep original row id for traceability.
4. Sort by `(status_start_date asc, status_end_date asc, id asc)`.
5. Remove exact duplicates by stable key:
- `(user_id, status, status_start_date, status_end_date, next_status)`.

## Boundary and clipping rules

Given selected window `[from, to]`:
- drop intervals fully outside
- clip partial overlaps to window boundaries
- forbid negative duration after clipping
- zero-length intervals may be kept as transitions but are excluded from duration sums

## Duration trust policy

`duration` from upstream is advisory only.

Canonical duration is recomputed as:
- `max(0, end - start)` in seconds

If recomputed duration differs from upstream value:
- keep recomputed value for analytics
- mark segment with `durationMismatch=true` for debugging/tooltips

## Overlap resolution

If two intervals overlap after normalization:
1. Prefer interval with later `status_start_date` as newer authoritative event.
2. Trim older interval end to newer start.
3. If complete shadowing occurs, discard hidden interval.
4. Record overlap correction count in debug metadata.

## Gap detection

After sorting and overlap resolution:
- any real uncovered span inside `[from, to]` becomes system segment `NO_DATA`
- do not infer status without evidence

## First segment restoration (critical)

Goal: determine status at `from` safely.

Algorithm:
1. Load intervals in main range.
2. Execute bounded lookback query where `to = from - 1 second`.
3. Search for latest reliable status before boundary.
4. If found and continuity is defensible, prepend clipped segment from `from` until first known event.
5. If not found, prepend `NO_DATA` and attach reason.

Continuity is defensible when at least one of:
- lookback row overlaps into boundary
- lookback row ends exactly at boundary
- lookback row has `next_status` that matches first in-range status transition pattern

If evidence is ambiguous, prefer `NO_DATA`.

## Lookback policy

- initial lookback window: 6 hours before `from`
- if not found, expand progressively: 12h, 24h
- hard cap: 48h
- stop after first reliable predecessor
- no infinite expansion

Rationale:
- balances correctness with upstream/API cost
- prevents unbounded queries

## Cross-midnight and DST

- all calculations happen in UTC
- display conversion uses explicit report/display timezone
- DST impact is only at presentation layer and label formatting
- never compute durations in local wall-clock directly

## Working hours handling

Working hours do not clip source data.

Two outputs are computed:
- full-window aggregates
- working-hours aggregates computed by interval intersection

Outside working-hours span is rendered as system overlay/segment `OUT_OF_WORKING_TIME`.

## System statuses

Reserved synthetic statuses:
- `NO_DATA`
- `OUT_OF_WORKING_TIME`
- `LOAD_ERROR`
- `UNKNOWN_STATUS`

These statuses are never sent upstream and are tagged `isSystem=true`.

## Quality invariants

Builder output must satisfy:
1. segments sorted by start asc
2. segment start < end for measurable segments
3. no overlapping measurable segments
4. union of measurable + `NO_DATA` covers whole selected interval (unless explicit load failure)
5. total measurable duration <= selected window duration

## UX flags per segment

Segment carries additional flags for tooltip transparency:
- `isCalculated`
- `isClippedByRange`
- `isFromLookback`
- `durationMismatch`
- `gapFilled`
