#!/usr/bin/env bash
set -euo pipefail

docflow_url='http://127.0.0.1:8010'
docsgpt_api_url='http://127.0.0.1:7091/api/health'
docsgpt_frontend_url='http://127.0.0.1:5173'
docsgpt_ops_url='http://127.0.0.1:5173/ops/'

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
check_url 'DocsGPT RAG Ops' "${docsgpt_ops_url}"

frontend_html="$(curl -sS --connect-timeout 5 --max-time 20 "${docsgpt_frontend_url}/")"
if [[ "${frontend_html}" != *'/assets/'* ]] || \
  [[ "${frontend_html}" == *'/@vite/client'* ]] || \
  [[ "${frontend_html}" == *'/src/main.tsx'* ]]; then
  printf '[FAIL] DocsGPT frontend is not serving the production bundle\n' >&2
  exit 1
fi
printf '[PASS] DocsGPT frontend serves hashed production assets\n'

ops_html="$(curl -sS --connect-timeout 5 --max-time 20 "${docsgpt_ops_url}")"
ops_data="$(curl -sS --connect-timeout 5 --max-time 20 "${docsgpt_ops_url}data.json")"
if [[ "${ops_html}" != *'企业知识库 RAG 诊断台'* ]] || \
  [[ "${ops_data}" != *'fixed_evaluation_snapshot'* ]]; then
  printf '[FAIL] DocsGPT RAG Ops assets are incomplete\n' >&2
  exit 1
fi
printf '[PASS] DocsGPT RAG Ops serves the verified evaluation snapshot\n'

if [[ -f .shared-agent-token ]]; then
  shared_agent_token="$(tr -d '\r\n' <.shared-agent-token)"
  shared_agent_json="$(
    curl -sS --connect-timeout 5 --max-time 20 \
      "http://127.0.0.1:7091/api/shared_agent?token=${shared_agent_token}"
  )"
  SHARED_AGENT_JSON="${shared_agent_json}" python3 - <<'PY'
import json
import os
import sys

agent = json.loads(os.environ["SHARED_AGENT_JSON"])
if not agent.get("sources"):
    print("[FAIL] Shared Agent has no multi-source bindings", file=sys.stderr)
    raise SystemExit(1)
if agent.get("retriever") != "hybrid" or str(agent.get("chunks")) != "8":
    print("[FAIL] Shared Agent retrieval configuration drifted", file=sys.stderr)
    raise SystemExit(1)
print("[PASS] Shared Agent retains sources, hybrid retrieval and 8 chunks")
PY
fi

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
  health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "${container}")"
  if [[ "${health}" != 'none' && "${health}" != 'healthy' ]]; then
    printf '[FAIL] %s health=%s\n' "${container}" "${health}" >&2
    exit 1
  fi
  printf '[PASS] %s state=running restarts=%s\n' "${container}" "${restarts}"
done

printf '\nResource snapshot:\n'
docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}'
free -h
df -h /
