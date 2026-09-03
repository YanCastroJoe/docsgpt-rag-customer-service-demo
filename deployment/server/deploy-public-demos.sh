#!/usr/bin/env bash
set -euo pipefail

base_dir="${DEMO_BASE_DIR:-/opt/agent-demos}"
demo_owner="${DEMO_OWNER:-ubuntu:ubuntu}"
docflow_dir="${base_dir}/docflow"
docsgpt_dir="${base_dir}/docsgpt"

: "${DOCFLOW_PUBLIC_URL:?Set DOCFLOW_PUBLIC_URL, for example https://docflow.example.com}"
: "${DOCSGPT_PUBLIC_URL:?Set DOCSGPT_PUBLIC_URL, for example https://rag.example.com}"
: "${DOCSGPT_AGENT_ID:?Set DOCSGPT_AGENT_ID to the restored demo Agent UUID}"
: "${DOCSGPT_SOURCE_ID:?Set DOCSGPT_SOURCE_ID to the restored demo Source UUID}"

for archive in /tmp/docflow.tar.gz /tmp/docsgpt-server.tar.gz; do
  if [[ ! -f "${archive}" ]]; then
    printf 'Required deployment archive is missing: %s\n' "${archive}" >&2
    exit 1
  fi
done

upsert_env() {
  local file="$1"
  local key="$2"
  local value="$3"
  local temporary
  umask 077
  touch "${file}"
  temporary="$(mktemp "${file}.tmp.XXXXXX")"
  awk -v key="${key}" -v value="${value}" '
    BEGIN { found = 0 }
    $0 ~ "^" key "=" { print key "=" value; found = 1; next }
    { print }
    END { if (!found) print key "=" value }
  ' "${file}" >"${temporary}"
  mv "${temporary}" "${file}"
  chmod 600 "${file}"
}

install -d -m 0755 "${docflow_dir}" "${docsgpt_dir}"
tar -xzf /tmp/docflow.tar.gz -C "${docflow_dir}"
tar -xzf /tmp/docsgpt-server.tar.gz -C "${docsgpt_dir}"

for artifact in \
  "${docsgpt_dir}/migration/indexes" \
  "${docsgpt_dir}/migration/inputs" \
  "${docsgpt_dir}/migration/vectors" \
  "${docsgpt_dir}/migration/docsgpt-demo.dump"; do
  if [[ ! -e "${artifact}" ]]; then
    printf 'Required private migration artifact is missing: %s\n' "${artifact}" >&2
    exit 1
  fi
done

install -d -m 0755 "${docsgpt_dir}/data"
cp -a "${docsgpt_dir}/migration/indexes" "${docsgpt_dir}/data/"
cp -a "${docsgpt_dir}/migration/inputs" "${docsgpt_dir}/data/"
cp -a "${docsgpt_dir}/migration/vectors" "${docsgpt_dir}/data/"

if [[ ! -f "${docsgpt_dir}/.env" ]]; then
  umask 077
  postgres_password="$(openssl rand -hex 24)"
  internal_key="$(openssl rand -hex 32)"
  {
    printf 'POSTGRES_PASSWORD=%s\n' "${postgres_password}"
    printf 'INTERNAL_KEY=%s\n' "${internal_key}"
  } >"${docsgpt_dir}/.env"
fi

if [[ ! -f "${docsgpt_dir}/.shared-agent-token" ]]; then
  umask 077
  openssl rand -hex 24 >"${docsgpt_dir}/.shared-agent-token"
fi
shared_agent_token="$(tr -d '\r\n' <"${docsgpt_dir}/.shared-agent-token")"
upsert_env "${docsgpt_dir}/.env" PUBLIC_API_URL ""
upsert_env "${docsgpt_dir}/.env" SHARED_AGENT_TOKEN "${shared_agent_token}"
upsert_env "${docsgpt_dir}/.env" DOCSGPT_BIND_ADDRESS "127.0.0.1"
upsert_env "${docsgpt_dir}/.env" DOCSGPT_FRONTEND_PORT "5173"

demo_username="${DEMO_USERNAME:-interviewer}"
if [[ -n "${DEMO_PASSWORD:-}" ]]; then
  demo_password="${DEMO_PASSWORD}"
elif [[ -f "${docsgpt_dir}/.demo-password" ]]; then
  demo_password="$(tr -d '\r\n' <"${docsgpt_dir}/.demo-password")"
else
  demo_password="$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9_-')"
fi
printf '%s\n' "${demo_username}" >"${docsgpt_dir}/.demo-username"
printf '%s\n' "${demo_password}" >"${docsgpt_dir}/.demo-password"
printf '%s:%s\n' "${demo_username}" "$(openssl passwd -apr1 "${demo_password}")" >"${docsgpt_dir}/.demo-htpasswd"
chmod 600 "${docsgpt_dir}/.demo-username" "${docsgpt_dir}/.demo-password" "${docsgpt_dir}/.demo-htpasswd"

upsert_env "${docflow_dir}/.env" DOCFLOW_DEMO_MODE "true"
upsert_env "${docflow_dir}/.env" DOCFLOW_DEMO_USERNAME "${demo_username}"
upsert_env "${docflow_dir}/.env" DOCFLOW_DEMO_PASSWORD "${demo_password}"
upsert_env "${docflow_dir}/.env" DOCFLOW_RATE_LIMIT_PER_MINUTE "60"
upsert_env "${docflow_dir}/.env" DOCFLOW_BIND_ADDRESS "127.0.0.1"
upsert_env "${docflow_dir}/.env" DOCFLOW_PORT "8010"

sudo chown -R "${demo_owner}" "${base_dir}"

cd "${docflow_dir}"
docker compose -f compose.public-demo.yml config -q
docker compose -f compose.public-demo.yml up -d --build

cd "${docsgpt_dir}"
docker compose --env-file .env -f docker-compose.public.yml config -q
docker compose --env-file .env -f docker-compose.public.yml pull redis postgres
docker compose --env-file .env -f docker-compose.public.yml build backend frontend
docker compose --env-file .env -f docker-compose.public.yml up -d postgres redis

for attempt in $(seq 1 30); do
  if docker compose --env-file .env -f docker-compose.public.yml exec -T postgres \
    pg_isready -U docsgpt -d docsgpt >/dev/null 2>&1; then
    break
  fi
  if [[ "${attempt}" -eq 30 ]]; then
    printf 'PostgreSQL did not become ready in time.\n' >&2
    exit 1
  fi
  sleep 2
done

if [[ ! -f .database-restored ]]; then
  docker cp migration/docsgpt-demo.dump docsgpt-demo-postgres:/tmp/docsgpt-demo.dump
  docker compose --env-file .env -f docker-compose.public.yml exec -T postgres \
    pg_restore -U docsgpt -d docsgpt --clean --if-exists --no-owner --exit-on-error \
    /tmp/docsgpt-demo.dump
  touch .database-restored
fi

docker cp configure-public-agent.sql docsgpt-demo-postgres:/tmp/configure-public-agent.sql
docker compose --env-file .env -f docker-compose.public.yml exec -T postgres \
  psql -U docsgpt -d docsgpt -v ON_ERROR_STOP=1 \
  -v agent_id="${DOCSGPT_AGENT_ID}" \
  -v source_id="${DOCSGPT_SOURCE_ID}" \
  -v shared_agent_token="${shared_agent_token}" \
  -f /tmp/configure-public-agent.sql

docker compose --env-file .env -f docker-compose.public.yml up -d --no-build backend worker frontend

sudo chown "${demo_owner}" .database-restored .shared-agent-token .demo-username .demo-password .demo-htpasswd .env

printf 'DOCFLOW_URL=%s\n' "${DOCFLOW_PUBLIC_URL%/}"
printf 'DOCSGPT_URL=%s/demo\n' "${DOCSGPT_PUBLIC_URL%/}"
printf 'DOCSGPT_OPS_URL=%s/ops/\n' "${DOCSGPT_PUBLIC_URL%/}"
printf 'DEMO_USERNAME=%s\n' "${demo_username}"
printf 'DEMO_PASSWORD_FILE=%s\n' "${docsgpt_dir}/.demo-password"
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
free -h
df -h /
