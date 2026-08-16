#!/usr/bin/env bash
set -euo pipefail

base_dir=/opt/agent-demos
docflow_dir="${base_dir}/docflow"
docsgpt_dir="${base_dir}/docsgpt"

install -d -m 0755 "${docflow_dir}" "${docsgpt_dir}"
tar -xzf /tmp/docflow.tar.gz -C "${docflow_dir}"
tar -xzf /tmp/docsgpt-server.tar.gz -C "${docsgpt_dir}"

install -d -m 0755 "${docsgpt_dir}/data"
cp -a "${docsgpt_dir}/migration/indexes" "${docsgpt_dir}/data/"
cp -a "${docsgpt_dir}/migration/inputs" "${docsgpt_dir}/data/"
cp -a "${docsgpt_dir}/migration/vectors" "${docsgpt_dir}/data/"

if [[ ! -f "${docsgpt_dir}/.env" ]]; then
  umask 077
  postgres_password="$(openssl rand -hex 24)"
  internal_key="$(openssl rand -hex 32)"
  {
    printf 'PUBLIC_API_URL=http://124.221.243.125:7091\n'
    printf 'POSTGRES_PASSWORD=%s\n' "${postgres_password}"
    printf 'INTERNAL_KEY=%s\n' "${internal_key}"
  } >"${docsgpt_dir}/.env"
fi

sudo chown -R ubuntu:ubuntu "${base_dir}"

cd "${docflow_dir}"
docker compose -f compose.public-demo.yml up -d --build

cd "${docsgpt_dir}"
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
  psql -U docsgpt -d docsgpt -f /tmp/configure-public-agent.sql

if [[ ! -f .shared-agent-token ]]; then
  umask 077
  openssl rand -hex 24 >.shared-agent-token
fi
shared_agent_token="$(tr -d '\r\n' <.shared-agent-token)"
docker compose --env-file .env -f docker-compose.public.yml exec -T postgres \
  psql -U docsgpt -d docsgpt -v ON_ERROR_STOP=1 \
  -c "UPDATE agents SET shared = true, shared_token = '${shared_agent_token}', shared_metadata = jsonb_build_object('shared_by', 'Demo', 'purpose', 'interview_demo') WHERE id = '23d42c6b-bba6-4baa-ba87-aef53df8a0ae';"

docker compose --env-file .env -f docker-compose.public.yml up -d --no-build backend frontend

sudo chown ubuntu:ubuntu .database-restored .shared-agent-token .env

printf 'DOCFLOW_URL=http://124.221.243.125:8010\n'
printf 'DOCSGPT_URL=http://124.221.243.125:5173/shared/agent/%s\n' "${shared_agent_token}"
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
free -h
df -h /
