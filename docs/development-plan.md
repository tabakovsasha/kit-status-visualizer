# Development Plan and Progress

## Stage 1. Research

Status: DONE

Completed:
- inspected workspace structure
- analyzed all provided API request examples (`*.sh`)
- analyzed all response examples (`*.json`)
- extracted factual method mapping, parameters, result fields, and `_meta`
- identified key discrepancy in `searchStatuses.sh` (`domain={host}`)
- confirmed timezone evidence from `searchUsers.profile.utc` (IANA sample)
- identified missing upstream error examples as explicit risk

Created/updated files:
- `docs/api-analysis.md`

Key decisions:
- treat API samples as source of truth
- do not invent fields absent in samples
- for unknown error shape, implement defensive parser + internal error mapping

Open issues discovered:
- no official error payload examples
- one ambiguous parameter typo in status history sample

## Stage 2. Architecture

Status: DONE

Completed:
- selected modular monolith architecture
- defined backend module boundaries
- defined session and token security model
- defined encrypted credential storage model (AES-256-GCM)
- defined cache policy by data category
- defined timeline reconstruction strategy and lookback policy

Created/updated files:
- `docs/architecture.md`
- `docs/security.md`
- `docs/status-timeline-rules.md`

Key decisions:
- strict ownership scoping on all tenant data
- server-side PDF generation
- Redis for cache + single-flight locking

## Stage 3. Infrastructure

Status: DONE

Completed:
- created monorepo folders and workspace package structure
- added `.env.example`, `.gitignore`, `scripts/init-secrets.sh`
- added `docker-compose.yml`, `docker-compose.dev.yml`
- added Caddy config in `infrastructure/caddy/Caddyfile`
- added Dockerfiles for frontend/backend dev and production
- added `Makefile` targets (`init/dev/build/up/down/logs/migrate/seed/test/lint/e2e`)

Notes:
- local terminal runtime uses Node 18, while current latest ecosystem versions expect Node 20+.
- implementation pinned compatible versions where needed to keep project runnable in current environment.

## Stage 4. Backend foundation

Status: DONE

Completed:
- NestJS backend scaffolded and modularized
- Prisma schema created with required domain entities
- auth/login/refresh/logout/me endpoints with DB refresh session hash
- bootstrap user sync from ENV with Argon2id
- admin user API protected by `ADMIN_API_KEY` and internal host check
- AES-256-GCM encryption service for Vox token storage
- health endpoints and OpenAPI setup

## Stage 5. Voximplant integration

Status: DONE

Completed:
- centralized Voximplant API service
- host validation and SSRF defensive checks
- `getAccountInfo` verification endpoint
- reusable paginated loader for `_meta` based endpoints
- catalog refresh and snapshot persistence (queues/groups/users/status-types)

Pending:
- advanced retry/backoff, rate-limit aware circuit breaker
- dedicated mock upstream service for test matrix

## Stage 6. Timeline domain

Status: DONE

Completed:
- timeline query endpoint
- initial timeline builder with sorting, clipping, overlap trimming, gap fill (`NO_DATA`)
- unit tests for builder behavior
- bounded lookback restoration for first segment continuity (6h/12h/24h/48h)
- timeline service tests for lookback recovery and fallback behavior
- full-window aggregation model (`windowDurationSec`, `measurableDurationSec`, `noDataDurationSec`, per-status durations)
- percentage policy tests over measurable duration with overlap-trimmed source intervals
- timezone and DST-focused tests for local rendering labels and date-boundary metadata
- timezone resolver fallback to UTC for invalid IANA zones (defensive transformation behavior)

Pending:
- none

## Stage 7. Frontend

Status: DONE

Completed:
- React + Vite frontend scaffolded
- app routing and protected shell navigation
- login page and credentials connection page
- operators refresh/list view
- advanced timeline visualization page (operator picker, aggregates, segment bars, local time labels)
- UX state coverage for timeline flow (idle/loading/error/empty/partial success)
- timeline segment detail panel with boundary/offset metadata
- keyboard accessibility for timeline rows (Arrow/Home/End navigation, focus and pressed states)
- robust session restore via refresh bootstrap on app startup

Pending:
- none for current scope

## Stage 8. Reporting removal

Status: DONE

Completed:
- removed backend report-generation module and its API endpoint
- removed frontend Reports route and navigation tab
- removed report entities from Prisma schema
- removed PDF generation dependencies and related test coverage

Pending:
- none

## Stage 9. Verification

Status: IN PROGRESS

Completed:
- backend and frontend builds pass
- backend unit tests pass
- backend e2e health smoke test passes
- lint passes for backend and frontend (frontend has TS version support warning only)

Pending:
- integration tests for business flows
- full e2e scenario set from requirements
- docker compose full startup validation in this run

## Stage 10. Final audit

Status: DONE

Completed:
- secrets scan (no hardcoded secrets found)
- tenant isolation checks across owner-scoped modules
- timezone and first-segment audit (including invalid timezone fallback)
- docs finalization (`docs/final-audit.md`)
