#!/usr/bin/env bash
set -euo pipefail

docflow_url="${DOCFLOW_CHECK_URL:-http://127.0.0.1:8010}"
docsgpt_base_url="${DOCSGPT_CHECK_URL:-http://127.0.0.1:5173}"
docsgpt_api_url="${docsgpt_base_url%/}/api/health"
docsgpt_entry_url="${docsgpt_base_url%/}/demo"
docsgpt_ops_url="${docsgpt_base_url%/}/ops/"

if [[ ! -f .demo-username || ! -f .demo-password || ! -f .shared-agent-token || ! -f .agent-api-key ]]; then
  printf '[FAIL] Missing demo credentials, shared Agent token or Agent API key\n' >&2
  exit 1
fi
demo_username="$(tr -d '\r\n' <.demo-username)"
demo_password="$(tr -d '\r\n' <.demo-password)"
shared_agent_token="$(tr -d '\r\n' <.shared-agent-token)"
auth_args=(-u "${demo_username}:${demo_password}")

check_url() {
  local name="$1"
  local url="$2"
  local status
  status="$(curl "${auth_args[@]}" -L -sS -o /dev/null -w '%{http_code}' --connect-timeout 5 --max-time 20 "${url}")"
  if [[ "${status}" != '200' ]]; then
    printf '[FAIL] %s returned HTTP %s\n' "${name}" "${status}" >&2
    return 1
  fi
  printf '[PASS] %s returned HTTP 200\n' "${name}"
}

check_url 'DocFlow' "${docflow_url}"
check_url 'DocsGPT API' "${docsgpt_api_url}"
check_url 'DocsGPT entry' "${docsgpt_entry_url}"
check_url 'DocsGPT RAG Ops' "${docsgpt_ops_url}"

demo_html="$(curl "${auth_args[@]}" -L -sS --connect-timeout 5 --max-time 20 "${docsgpt_entry_url}")"
demo_script="$(curl "${auth_args[@]}" -sS --connect-timeout 5 --max-time 20 "${docsgpt_base_url%/}/demo/app.js")"
if [[ "${demo_html}" != *'售后智能助手'* ]] || \
  [[ "${demo_html}" != *'在线咨询'* ]] || \
  [[ "${demo_html}" == *'__SHARED_AGENT_TOKEN__'* ]] || \
  [[ "${demo_script}" != *"fetch('/stream'"* ]] || \
  [[ "${demo_script}" != *'/api/shared_agent?token='* ]]; then
  printf '[FAIL] DocsGPT business UI is missing or not connected to the shared Agent\n' >&2
  exit 1
fi
printf '[PASS] DocsGPT business UI serves the live shared-Agent experience\n'

docsgpt_frontend_url="${docsgpt_base_url%/}/agents/shared/${shared_agent_token}"
frontend_html="$(curl "${auth_args[@]}" -sS --connect-timeout 5 --max-time 20 "${docsgpt_frontend_url}")"
if [[ "${frontend_html}" != *'/assets/'* ]] || \
  [[ "${frontend_html}" != *'rag-ops-entry'* ]] || \
  [[ "${frontend_html}" == *'/@vite/client'* ]] || \
  [[ "${frontend_html}" == *'/src/main.tsx'* ]]; then
  printf '[FAIL] DocsGPT frontend is not serving the production bundle\n' >&2
  exit 1
fi
printf '[PASS] DocsGPT frontend serves hashed production assets\n'

ops_html="$(curl "${auth_args[@]}" -sS --connect-timeout 5 --max-time 20 "${docsgpt_ops_url}")"
ops_data="$(curl "${auth_args[@]}" -sS --connect-timeout 5 --max-time 20 "${docsgpt_ops_url}data.json")"
if [[ "${ops_html}" != *'RAG 诊断台'* ]] || \
  [[ "${ops_html}" != *'href="/demo"'* ]] || \
  [[ "${ops_data}" != *'fixed_evaluation_snapshot'* ]]; then
  printf '[FAIL] DocsGPT RAG Ops assets are incomplete\n' >&2
  exit 1
fi
printf '[PASS] DocsGPT RAG Ops serves the verified evaluation snapshot\n'

shared_agent_json="$(
  curl "${auth_args[@]}" -sS --connect-timeout 5 --max-time 20 \
    "${docsgpt_base_url%/}/api/shared_agent?token=${shared_agent_token}"
)"
SHARED_AGENT_JSON="${shared_agent_json}" python3 - <<'PY'
import json
import os
import sys

agent = json.loads(os.environ["SHARED_AGENT_JSON"])
if not agent.get("sources"):
    print("[FAIL] Shared Agent has no multi-source bindings", file=sys.stderr)
    raise SystemExit(1)
if agent.get("retriever") != "hybrid" or str(agent.get("chunks")) != "2":
    print("[FAIL] Shared Agent retrieval configuration drifted", file=sys.stderr)
    raise SystemExit(1)
print("[PASS] Shared Agent retains sources, hybrid retrieval and 2 chunks")
PY

for container in \
  docflow-demo \
  docsgpt-demo-frontend \
  docsgpt-demo-backend \
  docsgpt-demo-worker \
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
