#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env"
EXAMPLE_FILE="${ROOT_DIR}/.env.example"
TMP_FILE="${ROOT_DIR}/.env.tmp"

if [[ ! -f "${EXAMPLE_FILE}" ]]; then
  echo "Missing .env.example" >&2
  exit 1
fi

if [[ ! -f "${ENV_FILE}" ]]; then
  cp "${EXAMPLE_FILE}" "${ENV_FILE}"
fi

chmod 600 "${ENV_FILE}"

if ! command -v openssl >/dev/null 2>&1; then
  echo "Missing dependency: openssl" >&2
  exit 1
fi

get_var() {
  local key="$1"
  local value
  value="$(grep -E "^${key}=" "${ENV_FILE}" | head -n1 | cut -d'=' -f2- || true)"
  printf "%s" "${value}"
}

upsert_var() {
  local key="$1"
  local value="$2"

  if grep -qE "^${key}=" "${ENV_FILE}"; then
    sed "s|^${key}=.*$|${key}=${value}|" "${ENV_FILE}" > "${TMP_FILE}"
    mv "${TMP_FILE}" "${ENV_FILE}"
  else
    printf "\n%s=%s\n" "${key}" "${value}" >> "${ENV_FILE}"
  fi
}

ensure_var() {
  local key="$1"
  local gen_cmd="$2"
  local value

  if grep -qE "^${key}=" "${ENV_FILE}"; then
    value="$(get_var "${key}")"
    if [[ -n "${value}" ]]; then
      return 0
    fi
  fi

  value="$(eval "${gen_cmd}")"
  upsert_var "${key}" "${value}"
}

ensure_var_or_default() {
  local key="$1"
  local gen_cmd="$2"
  local default_pattern="$3"
  local value

  value="$(get_var "${key}")"
  if [[ -n "${value}" ]] && [[ ! "${value}" =~ ${default_pattern} ]]; then
    return 0
  fi

  value="$(eval "${gen_cmd}")"
  upsert_var "${key}" "${value}"
}

sync_database_url() {
  local db_host db_port db_name db_user db_password db_schema db_url

  db_host="$(get_var "DATABASE_HOST")"
  db_port="$(get_var "DATABASE_PORT")"
  db_name="$(get_var "DATABASE_NAME")"
  db_user="$(get_var "DATABASE_USER")"
  db_password="$(get_var "DATABASE_PASSWORD")"

  db_host="${db_host:-postgres}"
  db_port="${db_port:-5432}"
  db_name="${db_name:-kit_operator_statuses}"
  db_user="${db_user:-kitapp}"

  # Keep this aligned with Prisma schema default unless project adds DATABASE_SCHEMA.
  db_schema="public"
  db_url="postgresql://${db_user}:${db_password}@${db_host}:${db_port}/${db_name}?schema=${db_schema}"

  upsert_var "DATABASE_URL" "${db_url}"
}

ensure_var "JWT_ACCESS_SECRET" "openssl rand -hex 64"
ensure_var "JWT_REFRESH_SECRET" "openssl rand -hex 64"
ensure_var "TOKEN_ENCRYPTION_KEY" "openssl rand -hex 32"
ensure_var "ADMIN_API_KEY" "openssl rand -hex 64"
ensure_var "DATABASE_PASSWORD" "openssl rand -hex 32"
ensure_var "CSRF_SECRET" "openssl rand -hex 64"
ensure_var_or_default "INIT_ADMIN_PASSWORD" "openssl rand -hex 16" "^(change-me-please|change-me)$"
ensure_var_or_default "BOOTSTRAP_USER_PASSWORD" "openssl rand -hex 16" "^(change-me-please|change-me)$"

sync_database_url

echo "Secrets initialized in .env and DATABASE_URL synchronized with DATABASE_* values."
