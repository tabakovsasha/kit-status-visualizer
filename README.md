# Kit Operator Statuses

Приложение для аналитики статусов операторов Voximplant Kit: frontend, backend, PostgreSQL, Redis и Caddy в production-архитектуре с отдельной VM для reverse proxy.

## Что в проекте

- Frontend: React + Vite + TypeScript
- Backend: NestJS + TypeScript + Prisma
- База данных: PostgreSQL
- Кеш: Redis
- Reverse proxy: Caddy
- Docker Compose для локального запуска и production-развёртывания

## Основная архитектура

```text
Internet
   |
   | 80/443
   v
External Caddy VM
   |
   | private LAN / HTTP
   v
Application VM
   |
   v
frontend/internal gateway :8080
   |
   +--> /            -> frontend
   +--> /api/*      -> backend:3000
   +--> /health/*   -> backend:3000
   +--> /docs*      -> backend:3000
```

Смысл такой:
- публичный вход только на отдельной Caddy VM
- приложение на другой VM не открывает 80/443 в интернет
- внутри VM используется приватная Docker-сеть
- внешний Caddy обращается к приложению по приватному IP и одному ingress-порту

## Локальный запуск

1. Скопируйте пример env:
```bash
cp .env.example .env
```

2. Запустите приложение:
```bash
docker compose up -d --build
```

3. Проверьте состояние:
```bash
docker compose ps
```

4. Остановите:
```bash
docker compose down
```

## Production

### 1. Application VM
Используется compose-файл:
```bash
deploy/application-vm/docker-compose.production.yml
```

Он запускает:
- frontend на порту `localhost:8080`
- backend внутри Docker-сети `app`
- PostgreSQL и Redis внутри сети `data`

### 2. Внешний Caddy VM
Пример конфигурации находится здесь:
```bash
deploy/external-caddy-example/Caddyfile
```

Пример:
```caddy
{
    email admin@example.com
}

kit.example.com {
    reverse_proxy localhost:8080
}
```

Это означает:
- браузер идёт на `https://kit.example.com`
- Caddy VM принимает TLS и проксирует запрос в application VM по private LAN
- приложение не знает о публичном интернете напрямую

## Переменные окружения

Основные значения для production:
```bash
HOST_BIND_IP=127.0.0.1
HOST_HTTP_PORT=8080
PUBLIC_APP_URL=https://kit.example.com
PUBLIC_API_URL=https://kit.example.com/api
CORS_ORIGIN=https://kit.example.com
```

Пример production env находится в:
```bash
deploy/application-vm/.env.production.example
```

## Безопасность

- только внешний Caddy VM открыт на `80` и `443`
- application VM не должен принимать входящий трафик из интернета
- PostgreSQL и Redis не публикуются на host-порты
- внутренние сети Docker остаются приватными

## Полезные команды

Проверить compose:
```bash
docker compose config
```

Проверить ingress на application VM:
```bash
ss -lntp | grep 8080
curl -I http://localhost:8080
curl http://localhost:8080/api/health/live
```

Проверить health backend:
```bash
curl http://localhost:3000/health/live
```

## Ссылки на дополнительную документацию

- docs/architecture.md
- docs/security.md
- docs/api-analysis.md
- docs/development-plan.md

## Разработка

Для локальной разработки можно использовать обычный stack проекта и `.env` на основе `.env.example`.

Для production важно не смешивать:
- внешний Caddy VM
- приложение внутри другой VM
- Docker networks между разными машинами

Именно эта схема позволяет безопасно запускать несколько проектов на одном сервере и не открывать лишние порты наружу.

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
