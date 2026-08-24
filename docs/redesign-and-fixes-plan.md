# Redesign and Fixes Plan

## What is currently implemented incorrectly

- The frontend shell is still a minimal Vite scaffold with generic spacing, typography, and colors.
- The Connection page now tests Voximplant credentials, but the UX does not yet satisfy the required locked/success/edit states or account details layout.
- The Operators page only shows a queue list and does not implement queue expansion, operator filtering, checkbox selection, persistence, or local time display.
- The Timeline page is still built around an old row/bar model and does not render one unified timeline track per operator.
- The Settings page is functionally acceptable but still uses the old shell styling.
- The favicon is still the Vite default.

## Existing backend methods that already exist

- `POST /api/auth/login`, `POST /api/auth/refresh`, `POST /api/auth/logout`, `GET /api/auth/me`
- `PUT /api/voximplant/credentials`
- `PUT /api/voximplant/credentials/test`
- `GET /api/voximplant/credentials`
- `POST /api/catalog/refresh`
- `GET /api/catalog/queues`
- `GET /api/catalog/groups`
- `GET /api/catalog/operators`
- `GET /api/catalog/status-types`
- `POST /api/timelines/query`

## Backend methods and behaviors that need attention

- `VoximplantApiService.searchStatuses` should be validated against the real pagination and request shape from `api_examples`.
- `TimelineService` and `timeline-builder` need to match the required one-track timeline semantics, lookback recovery, and complete status gap handling.
- `CatalogService.refresh` already caches snapshots in the database, but the frontend still needs to use the cached data as the default source and only refresh on demand.

## Components that can be reused

- `apps/backend/src/modules/catalog/*`
- `apps/backend/src/modules/voximplant/*`
- `apps/backend/src/modules/timeline/*` as the backend starting point, with fixes
- `apps/backend/src/common/*`
- `apps/frontend/src/lib/api.ts`
- `apps/frontend/src/state/auth.ts`
- `apps/frontend/src/components/Layout.tsx` as the shell starting point

## Components that should be removed or replaced

- The current lightweight queue list in `OperatorsPage`.
- The current multi-row timeline visualization in `TimelinePage`.
- The default Vite favicon assets and HTML head metadata.
- The current generic CSS theme in `index.css` and `App.css` once the new shell styles are in place.

## New page structure

- Connection
  - left: connection form
  - right: connected account details
  - success and edit states are persistent and visible
- Operators
  - top toolbar with refresh, search, and group filter
  - queue accordion list
  - operator table within each queue
  - persistent selection actions
- Timeline
  - filter card
  - global axis
  - fixed operator column
  - one unified SVG/absolute-position timeline track per operator
  - expandable operator summary below each row
- Settings
  - keep current behavior, only align shell styling

## Unified timeline structure

- One operator = one timeline row.
- One row = one fixed left column + one time viewport + one track.
- The track is split into sequential status segments only.
- Status segments are calculated from real `searchStatuses` intervals, not from separate per-status bars.
- A single shared time axis drives all operator rows.

## Segment calculation algorithm

1. Load selected operator statuses from `searchStatuses` with full pagination.
2. Deduplicate identical rows.
3. Sort by `status_start_date` and normalize by the selected visible window.
4. Restore the first status before the visible window using the transition row or a lookback query when the first visible event cannot prove continuity.
5. Fill real gaps with `NO_DATA` only when the API cannot prove continuity.
6. Keep one contiguous track per operator and clip the segment geometry to the current viewport.
7. Use status type metadata for labels and colors.

## Timezone rules

- Prefer operator timezone if all selected operators share one timezone.
- If selected operators have mixed timezones, switch to per-operator timezone mode and show an explicit warning.
- Allow manual timezone selection only from a searchable list.
- Never use a free-text timezone input.
- Use the selected timezone for local labels, day boundaries, tooltips, and current-day calculations.

## Frontend data sources and persistence

- Use cached catalog snapshots from backend for queues, groups, users, and status types.
- Persist per-user selection and filter state in backend preferences.
- Persist selected operators without duplicates.
- Keep access tokens out of DOM, localStorage, and frontend state except for the in-memory auth session.

## Testing plan

- Backend unit tests for `searchStatuses` pagination and timeline reconstruction.
- Frontend component tests for Connection, Operators, and Timeline states.
- E2E smoke for login, credential verification, queue expansion, operator selection, and timeline rendering.
- Visual screenshots at desktop viewport after implementation.
- Final verification with build, lint, tests, and docker startup.
