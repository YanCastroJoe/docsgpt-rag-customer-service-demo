#!/usr/bin/env bash
set -euo pipefail

docflow_url='http://127.0.0.1:8010'
docsgpt_api_url='http://127.0.0.1:7091/api/health'
docsgpt_frontend_url='http://127.0.0.1:5173'

check_url() {
  local name="$1"
  local url="$2"
  local status
  status="$(curl -sS -o /dev/null -w '%{http_code}' --connect-timeout 5 --max-time 20 "${url}")"
  if [[ "${status}" != '200' ]]; then
    printf '[FAIL] %s returned HTTP %s\n' "${name}" "${status}" >&2
    return 1
  fi
  printf '[PASS] %s returned HTTP 200\n' "${name}"
}

check_url 'DocFlow' "${docflow_url}"
check_url 'DocsGPT API' "${docsgpt_api_url}"
check_url 'DocsGPT frontend' "${docsgpt_frontend_url}"

for container in \
  docflow-demo \
  docsgpt-demo-frontend \
  docsgpt-demo-backend \
  docsgpt-demo-postgres \
  docsgpt-demo-redis; do
  state="$(docker inspect -f '{{.State.Status}}' "${container}")"
  restarts="$(docker inspect -f '{{.RestartCount}}' "${container}")"
  if [[ "${state}" != 'running' ]]; then
    printf '[FAIL] %s state=%s restarts=%s\n' "${container}" "${state}" "${restarts}" >&2
    exit 1
  fi
  printf '[PASS] %s state=running restarts=%s\n' "${container}" "${restarts}"
done

printf '\nResource snapshot:\n'
docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}'
free -h
df -h /
