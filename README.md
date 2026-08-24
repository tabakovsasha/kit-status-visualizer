# Kit Operator Statuses

Production-oriented monorepo for Voximplant Kit operator status analytics:
- secure local user authentication,
- encrypted Voximplant credentials storage,
- catalog snapshots (queues/groups/operators/status types),
- timeline query API,
- tenant isolation by owner user.

## Architecture

- Frontend: React + Vite + TypeScript
- Backend: NestJS + TypeScript + Prisma
- Database: PostgreSQL
- Cache/infra: Redis
- Edge proxy: Caddy
- Orchestration: Docker Compose

Detailed design docs:
- `docs/architecture.md`
- `docs/api-analysis.md`
- `docs/security.md`
- `docs/status-timeline-rules.md`
- `docs/development-plan.md`

## Requirements

- Docker + Docker Compose
- Node.js (local tooling)
- OpenSSL (for secret generation script)

## Quick start (local)

1. Initialize `.env` and secrets:
```bash
make init
```

2. Start stack:
```bash
make up
```

3. Check logs:
```bash
make logs
```

4. Stop stack:
```bash
make down
```

## Development mode

```bash
make dev
```

## Environment setup

Use `.env.example` as baseline. Important variables:
- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
- `TOKEN_ENCRYPTION_KEY`
- `ADMIN_API_KEY`
- `DATABASE_PASSWORD`
- `BOOTSTRAP_USER_LOGIN`
- `BOOTSTRAP_USER_PASSWORD`
- `BOOTSTRAP_USER_ACTIVE`

For local manual API smoke tests only:
- `VOXIMPLANT_TEST_DOMAIN`
- `VOXIMPLANT_TEST_HOST`
- `VOXIMPLANT_TEST_ACCESS_TOKEN`

Do not commit real tokens/secrets.

## Secret generation

Idempotent script:
```bash
./scripts/init-secrets.sh
```

Behavior:
- creates `.env` from `.env.example` if missing,
- generates missing secrets only,
- keeps existing non-empty values unchanged,
- sets secure file permissions (`600`),
- does not print secrets.

## Migrations

Generate Prisma client:
```bash
npm run -w backend prisma:generate
```

Apply migrations:
```bash
make migrate
```

Seed bootstrap user:
```bash
make seed
```

## User management

### Bootstrap user
Defined by ENV:
- `BOOTSTRAP_USER_LOGIN`
- `BOOTSTRAP_USER_PASSWORD`
- `BOOTSTRAP_USER_ACTIVE`

Synchronized on backend startup.

### Admin API user operations
Internal endpoint set:
- `GET /api/admin/users`
- `POST /api/admin/users`
- `PATCH /api/admin/users/:id/status`
- `PATCH /api/admin/users/:id/password`

Requires `X-Admin-Api-Key` header with `ADMIN_API_KEY`.

## Caddy setup

Caddy is the only external ingress in compose:
- frontend via `/`
- backend via `/api/*` and `/health/*`

Config file:
- `infrastructure/caddy/Caddyfile`

## Production HTTPS deployment

Before first production deploy, set domain/TLS variables in `.env`:

```bash
NODE_ENV=production
PUBLIC_APP_URL=https://your.domain.tld
PUBLIC_API_URL=https://your.domain.tld/api
CORS_ORIGIN=https://your.domain.tld

CADDY_HTTP_SITE=:80
CADDY_HTTPS_SITE=your.domain.tld
CADDY_REDIRECT_HOST=your.domain.tld
CADDY_TLS_SERVER_NAME=your.domain.tld
# Production ACME mode (Let's Encrypt):
CADDY_TLS_MODE=admin@your.domain.tld

REFRESH_COOKIE_SECURE=true
REFRESH_COOKIE_SAMESITE=lax
```

Notes:
- For local/LAN only, use `CADDY_TLS_MODE=internal`.
- Keep backend/postgres/redis unpublished externally; only Caddy should expose ports 80/443.

### Deploy sequence

1. Validate compose and Caddy config:
```bash
docker compose config
docker run --rm -v "$(pwd)/infrastructure/caddy/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2.10 caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
```

2. Start stack:
```bash
make up
```

3. Watch Caddy logs until certificate is issued:
```bash
docker compose logs -f caddy
```

### Post-deploy checks (HTTPS, redirect, cert)

Replace `your.domain.tld` with real domain:

```bash
curl -I http://your.domain.tld
curl -I https://your.domain.tld
curl -I https://your.domain.tld/health/live
curl -I https://your.domain.tld/api/health/live
openssl s_client -connect your.domain.tld:443 -servername your.domain.tld </dev/null 2>/dev/null | openssl x509 -noout -issuer -subject -dates
```

Expected:
- HTTP returns `301` or `308` redirect to `https://your.domain.tld/...`
- HTTPS endpoints return `200` for live health checks
- Certificate issuer and validity dates are present and correct

### DNS and network prerequisites

- A/AAAA record for domain points to the server
- inbound `80/tcp` and `443/tcp` are open
- no other ingress/reverse proxy binds the same ports

### Rollback (TLS issues)

1. Revert only Caddy-related env vars/config to last known good values.
2. Restart edge service:
```bash
docker compose up -d --no-deps --build caddy
```
3. Re-check logs and health endpoints.

## Tests

Run all workspace tests:
```bash
make test
```

Run backend e2e:
```bash
make e2e
```

Run lint:
```bash
make lint
```

## Backup and restore (PostgreSQL)

Backup:
```bash
docker compose exec postgres pg_dump -U "$DATABASE_USER" "$DATABASE_NAME" > backup.sql
```

Restore:
```bash
cat backup.sql | docker compose exec -T postgres psql -U "$DATABASE_USER" "$DATABASE_NAME"
```

## Key rotation

### TOKEN_ENCRYPTION_KEY
Current implementation stores `keyVersion` with encrypted records.
Recommended process:
1. deploy code supporting dual-key decrypt,
2. re-encrypt credentials with new key,
3. switch default version,
4. remove old key after verification.

### JWT secrets
Recommended process:
1. support temporary dual-verify window,
2. rotate signing key,
3. force refresh-token rotation,
4. revoke old sessions if needed.

## Update Docker images

```bash
docker compose pull
docker compose up -d --build
```

## Troubleshooting

- `Prisma DATABASE_URL missing`:
  - ensure `.env` exists and `DATABASE_URL` is set.
- `401 on protected API`:
  - ensure access token is provided and refresh cookie is present.
- `credentials test fails`:
  - verify `domain`, `host`, `access_token`, and SSRF restrictions.
- `frontend cannot reach backend`:
  - verify Caddy routes and container health.

## Known API limitations

- Upstream Voximplant error payload examples were not provided in local samples.
- `searchStatuses.sh` sample uses `domain={host}` (documented discrepancy); implementation uses `domain` account name consistently.

## Timezone and first segment rules

See:
- `docs/status-timeline-rules.md`

Current implementation includes baseline UTC normalization, gap handling, and bounded first-segment lookback restoration (6h/12h/24h/48h windows).
Extended timezone fallback matrix and advanced aggregation semantics are planned in next iteration.
