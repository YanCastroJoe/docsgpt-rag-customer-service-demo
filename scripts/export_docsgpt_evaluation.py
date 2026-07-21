#!/usr/bin/env python3
"""Export the latest real DocsGPT answers for the repository evaluation set.

The script reads completed local conversations only. It does not submit prompts,
change Sources, or inspect the DocsGPT .env file.
"""

from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path
from typing import Any


def sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def source_names(raw_sources: Any) -> list[str]:
    if not isinstance(raw_sources, list):
        return []
    names: list[str] = []
    for source in raw_sources:
        if isinstance(source, str):
            names.append(source)
        elif isinstance(source, dict):
            name = source.get("filename") or source.get("title") or source.get("source")
            if name:
                names.append(str(name))
    return list(dict.fromkeys(names))


def main() -> int:
    parser = argparse.ArgumentParser(description="导出 DocsGPT 真实评测回答")
    parser.add_argument("--cases", type=Path, default=Path("evaluation/test_cases.json"))
    parser.add_argument("--docsgpt-dir", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    scope = parser.add_mutually_exclusive_group()
    scope.add_argument("--agent-id", help="只导出指定 Agent 的会话")
    scope.add_argument("--no-agent", action="store_true", help="只导出未绑定 Agent 的普通会话")
    args = parser.parse_args()

    cases = json.loads(args.cases.read_text(encoding="utf-8"))["cases"]
    by_question = {case["question"]: case["id"] for case in cases}
    literals = ", ".join(sql_literal(question) for question in by_question)
    scope_clause = ""
    if args.agent_id:
        scope_clause = f" and c.agent_id = {sql_literal(args.agent_id)}::uuid"
    elif args.no_agent:
        scope_clause = " and c.agent_id is null"
    sql = (
        "select distinct on (prompt) "
        "jsonb_build_object('prompt', cm.prompt, 'answer', cm.response, 'sources', cm.sources)::text "
        "from conversation_messages cm join conversations c on c.id = cm.conversation_id "
        f"where cm.status = 'complete' and cm.prompt in ({literals}){scope_clause} "
        "order by prompt, cm.timestamp desc;"
    )
    compose = [
        "docker", "compose", "--env-file", ".\\.env", "-f",
        ".\\deployment\\docker-compose-hub.yaml", "exec", "-T", "postgres",
        "psql", "-U", "docsgpt", "-d", "docsgpt", "-At", "-c", sql,
    ]
    completed = subprocess.run(
        compose,
        cwd=args.docsgpt_dir,
        text=True,
        encoding="utf-8",
        capture_output=True,
        check=False,
    )
    if completed.returncode != 0:
        raise RuntimeError(completed.stderr.strip() or "无法读取 DocsGPT 数据库。")

    exported: dict[str, dict[str, Any]] = {}
    for line in completed.stdout.splitlines():
        record = json.loads(line)
        case_id = by_question.get(record["prompt"])
        if case_id:
            exported[case_id] = {
                "case_id": case_id,
                "answer": record.get("answer") or "",
                "sources": source_names(record.get("sources")),
            }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    ordered = [exported[case["id"]] for case in cases if case["id"] in exported]
    args.out.write_text(
        "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in ordered),
        encoding="utf-8",
    )
    print(f"已导出 {len(ordered)}/{len(cases)} 条真实回答：{args.out}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, RuntimeError, json.JSONDecodeError) as exc:
        raise SystemExit(f"导出失败：{exc}")
