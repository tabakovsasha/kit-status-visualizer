# Security Model

## Threat model summary

Protected assets:
- service user credentials and sessions
- Voximplant Kit access tokens
- per-tenant snapshots, filters, and timeline data

Primary threats:
- tenant data leakage by ID substitution
- secret leakage in logs/errors/UI
- token theft via XSS/CSRF/session fixation
- SSRF via user-controlled host
- brute-force login and abuse of admin API

## Authentication and session controls

1. Password storage
- Argon2id with memory-hard parameters
- no plaintext storage or comparison
- password never logged

2. Access/refresh split
- short TTL access JWT
- long-lived refresh session in DB
- refresh token only in `HttpOnly/Secure/SameSite` cookie
- DB stores hash of refresh token, never plaintext

3. Rotation and revocation
- rotate refresh token on every refresh
- revoke on logout and clear cookie
- revoke all sessions on password change/deactivation/admin revoke
- cap active sessions per user

4. CSRF and browser hardening
- CSRF token for unsafe cookie-auth endpoints
- strict CORS allowlist
- no JWT in localStorage
- secure cookie attributes per environment

## Authorization and tenant isolation

Mandatory rule:
- every user-owned table stores `ownerUserId`

Enforcement:
- owner is derived from current auth session only
- repository queries always include owner scope
- no endpoint accepts owner from frontend as source of truth
- integration tests verify two-user isolation

## Voximplant credential protection

Storage format:
- AES-256-GCM authenticated encryption
- per-record random IV
- separate DB fields: ciphertext, iv, authTag, keyVersion

Operational rules:
- encryption key only from ENV
- token never returned by API
- UI receives only `tokenConfigured`, mask, lastCheckAt
- token not present in logs, traces, URLs, analytics, PDF, swagger examples

## SSRF protections for host

Validation pipeline:
1. Parse and normalize URL input.
2. Require `https` scheme.
3. Reject username/password in authority.
4. Resolve DNS and reject blocked IP classes by default:
- loopback
- link-local
- private RFC1918
- multicast/reserved ranges
5. Re-check DNS/IP before request (rebinding mitigation).
6. Optional explicit allowlist for known Voximplant hosts.

## API security and abuse controls

- DTO validation: whitelist + forbidNonWhitelisted
- request body size limits
- correlation ID
- rate limiting (strict on login)
- temporary lockout/backoff after repeated failed logins
- centralized error shaping without stack traces in production
- admin API protected by:
  - dedicated `ADMIN_API_KEY`
  - network policy (loopback/internal network only)

## Logging and audit

Structured JSON logs include:
- request id
- user id (if authenticated)
- method/path/status/duration
- upstream call metadata (without tokens)

Secret redaction policy:
- redact keys matching `token`, `access_token`, `authorization`, `password`, `secret`, `cookie`
- recursive redaction for nested objects

Audit events:
- login success/failure
- logout
- credential create/update/test
- catalog refresh
- admin user actions

## Infrastructure hardening baseline

- non-root containers
- no privileged mode
- minimal runtime images
- read-only fs where feasible
- healthchecks
- backend/postgres/redis not published externally in production
- Caddy as single ingress
- security headers at edge:
  - HSTS (prod)
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy`
  - `Permissions-Policy`
  - CSP

## Key rotation

- key version tracked per encrypted credential row
- support decrypt-with-old/encrypt-with-new migration flow
- JWT secret rotation via dual-secret verify window during transition

## Known unknowns from provided API samples

- upstream error schema is not provided
- implementation uses safe generalized parser and maps to internal error codes
- this limitation is documented and covered by mock-based tests
