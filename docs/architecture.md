# Architecture

## Goals

Production-ready web service for operator status analytics with strict tenant isolation, secure credential storage, and timeline reconstruction.

## Selected stack and version policy

Chosen as stable, non-experimental baseline as of 2026-07:
- Node.js: Active LTS line (v24 LTS family according to nodejs.org release table)
- Backend: NestJS (current stable line), TypeScript strict mode
- DB: PostgreSQL 18 (current manual on postgresql.org)
- Cache/locks: Redis 8 stable image line
- ORM: Prisma stable line (v6/v7-compatible schema patterns, no preview-only features)
- Frontend: React 19 + Vite (CRA intentionally not used; React docs recommend modern tooling)
- Reverse proxy/TLS edge: Caddy 2

If package manager resolves newer compatible patch/minor versions, it is acceptable.

## Monorepo layout

```text
/
├── apps/
│   ├── backend/
│   └── frontend/
├── packages/
│   ├── shared-types/
│   ├── api-client/
│   └── config/
├── api_examples/
├── docs/
├── infrastructure/
│   └── caddy/
├── scripts/
├── tests/
├── docker-compose.yml
├── docker-compose.dev.yml
├── .env.example
├── Makefile
└── README.md
```

## Backend architecture (modular monolith)

Modules:
- `AuthModule`: login/refresh/logout/me, token rotation, session revocation
- `UsersModule`: local service users, activation/deactivation
- `VoximplantCredentialsModule`: encrypted credentials storage + verification
- `VoximplantApiModule`: resilient upstream client (timeouts/retries/rate-limit handling)
- `QueuesModule`: queue/group/operator snapshots and refresh
- `OperatorsModule`: selection sets and operator lookup
- `StatusesModule`: status history loading, pagination helper, caching
- `TimelineModule`: interval builder, lookback logic, aggregation
- `CacheModule`: Redis wrappers, single-flight, lock helpers
- `AuditModule`: security/audit event logging
- `HealthModule`: liveness/readiness checks

Cross-cutting:
- correlation ID middleware
- centralized error mapper
- structured JSON logging with secret redaction
- DTO validation + whitelist/forbidUnknown
- OpenAPI docs for local API only

## Security model

### Authentication/session model
- Argon2id password hashes for service users
- Short-lived JWT access token (in-memory client use)
- Long-lived refresh token in `HttpOnly + Secure + SameSite` cookie
- DB stores only refresh token hash
- Rotation on each refresh
- Session invalidation on logout, user deactivation, password change, forced key rotation
- CSRF protection for cookie-authenticated refresh/logout/profile writes
- Session cap per user (configurable)

### Tenant isolation
- Every domain entity has `ownerUserId`
- Backend never trusts owner from client payload
- Ownership derived from authenticated session only
- All queries scoped by owner in repository layer
- IDs validated and filtered by ownership before action

### Voximplant credential protection
- `access_token` encrypted by AES-256-GCM
- random unique IV per record
- stored fields: `ciphertext`, `iv`, `authTag`, `keyVersion`
- encryption key loaded from ENV only
- token never returned to frontend, never logged, never shown in API docs
- masked display only and token update-by-replacement

### SSRF protection for host
- HTTPS required
- no credentials in URL
- hostname-only normalization
- DNS resolve + IP policy block (loopback/link-local/private by default)
- optional allowlist for known Voximplant hosts
- re-resolution check before outbound call to reduce DNS rebinding risk

## Voximplant integration strategy

- One resilient client for all upstream calls
- form-urlencoded requests to match examples
- timeout + abort support
- safe retries for idempotent requests only
- exponential backoff + jitter
- respect `Retry-After`
- classify upstream errors into internal machine codes:
  - `UPSTREAM_AUTH_FAILED`
  - `UPSTREAM_FORBIDDEN`
  - `UPSTREAM_VALIDATION_FAILED`
  - `UPSTREAM_RATE_LIMIT`
  - `UPSTREAM_TIMEOUT`
  - `UPSTREAM_TRANSPORT`
  - `UPSTREAM_UNAVAILABLE`
  - `UPSTREAM_MALFORMED_RESPONSE`

## Cache policy

Principles:
- correctness first, cache second
- user-scoped and account-scoped keys
- different TTL by data category
- manual refresh bypasses cache
- single-flight lock to prevent stampede

Suggested TTL:
- status types: 24h
- queues/groups/users snapshot: 15m (manual refresh available)
- status history for past days: 24h+
- status history for current day: 30-120s

Key dimensions for status cache:
- owner user id
- Vox account/domain
- operator id
- date
- `from`/`to`
- timezone
- request options that affect response

## Timeline reconstruction strategy

Because API sample contains interval rows + `next_status` but no explicit old_status:
1. Load requested window statuses.
2. Perform bounded lookback query before `from`.
3. Find last reliable row intersecting/preceding boundary.
4. Build normalized intervals in UTC.
5. Clip to selected range.
6. Fill real gaps with `NO_DATA`.
7. Never invent prior status when evidence is absent.

Detailed rules are in `docs/status-timeline-rules.md`.

## API discrepancies and decisions

- `searchStatuses.sh` sample uses `domain={host}` in query string; all other methods use `domain={domain}`.
- Implementation will use `domain` consistently and document this discrepancy.
- No upstream error payload sample exists. Error parser will handle unknown JSON/non-JSON bodies defensively.

## Why this architecture

- Modular monolith minimizes operational complexity at v1 while preserving domain boundaries.
- Strong ownership scoping and encrypted secrets satisfy core security constraints.
- Redis + single-flight + bounded concurrency supports large operator/time-range workloads.
