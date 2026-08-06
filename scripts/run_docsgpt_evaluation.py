#!/usr/bin/env python3
"""Run the local DocsGPT Agent against the real evaluation set.

The API key is read from an environment variable and is never written to the
output. Each case starts a new hidden conversation to prevent context leakage.
Completed JSONL rows are flushed immediately so an interrupted run can resume.
"""

from __future__ import annotations

import ast
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


CP1252_REVERSE = {}
for _byte in range(256):
    try:
        CP1252_REVERSE[bytes([_byte]).decode("cp1252")] = _byte
    except UnicodeDecodeError:
        continue


def repair_utf8_mojibake(text: str) -> tuple[str, bool]:
    """Repair UTF-8 bytes that were exposed as Latin-1/CP1252 characters.

    The repair is accepted only when it increases the number of CJK
    characters, so normal Chinese and ordinary Latin text remain untouched.
    """
    raw = bytearray()
    for character in text:
        codepoint = ord(character)
        if codepoint <= 255:
            raw.append(codepoint)
        elif character in CP1252_REVERSE:
            raw.append(CP1252_REVERSE[character])
        else:
            return text, False
    try:
        candidate = bytes(raw).decode("utf-8")
    except UnicodeDecodeError:
        return text, False
    cjk = lambda value: sum("\u4e00" <= char <= "\u9fff" for char in value)
    if cjk(candidate) > cjk(text):
        return candidate, True
    return text, False


def strip_serialized_thought_events(text: str) -> tuple[str, int]:
    """Remove only leading serialized thought-event dictionaries.

    Some local DocsGPT model streams expose ``{'type': 'thought', ...}``
    chunks in the answer field. This parser uses ``ast.literal_eval`` and stops
    at the first non-thought prefix, leaving ordinary answer text unchanged.
    """
    remaining = text
    stripped = 0
    marker = "{'type': 'thought'"
    while remaining.startswith(marker):
        parsed = None
        parsed_end = None
        for index, character in enumerate(remaining):
            if character != "}":
                continue
            try:
                candidate = ast.literal_eval(remaining[: index + 1])
            except (SyntaxError, ValueError):
                continue
            if isinstance(candidate, dict) and candidate.get("type") == "thought":
                parsed = candidate
                parsed_end = index + 1
                break
        if parsed is None or parsed_end is None:
            break
        remaining = remaining[parsed_end:]
        stripped += 1
    return remaining.lstrip(), stripped


def load_cases(path: Path) -> list[dict[str, Any]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    cases = payload.get("cases")
    if not isinstance(cases, list):
        raise ValueError("评测集必须包含 cases 数组。")
    return cases


def load_completed_ids(path: Path) -> set[str]:
    if not path.exists():
        return set()
    completed: set[str] = set()
    for line_no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ValueError(f"{path}:{line_no} 不是有效 JSON：{exc.msg}") from exc
        case_id = record.get("case_id")
        if isinstance(case_id, str):
            completed.add(case_id)
    return completed


def source_names(raw_sources: Any) -> list[str]:
    if not isinstance(raw_sources, list):
        return []
    names: list[str] = []
    for source in raw_sources:
        if isinstance(source, str):
            names.append(source)
            continue
        if not isinstance(source, dict):
            continue
        name = (
            source.get("filename")
            or source.get("title")
            or source.get("source")
            or source.get("name")
        )
        if not name:
            for nested_key in ("metadata", "document"):
                nested = source.get(nested_key)
                if isinstance(nested, dict):
                    name = (
                        nested.get("filename")
                        or nested.get("title")
                        or nested.get("source")
                        or nested.get("name")
                    )
                    if name:
                        break
        if name:
            names.append(str(name))
    return list(dict.fromkeys(names))


def ask_docsgpt(
    *, base_url: str, api_key: str, question: str, chunks: int, timeout: float
) -> dict[str, Any]:
    payload = {
        "question": question,
        "conversation_id": None,
        "chunks": chunks,
        "isNoneDoc": False,
        "api_key": api_key,
        "visibility": "hidden",
    }
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        base_url.rstrip("/") + "/api/answer",
        data=body,
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code}: {detail[:500]}") from exc
    elapsed_ms = round((time.perf_counter() - started) * 1000)
    result = json.loads(raw)
    if result.get("error"):
        raise RuntimeError(str(result["error"]))
    answer, encoding_repaired = repair_utf8_mojibake(
        str(result.get("answer") or "")
    )
    answer, thought_events_stripped = strip_serialized_thought_events(answer)
    return {
        "answer": answer,
        "sources": source_names(result.get("sources")),
        "conversation_id": result.get("conversation_id"),
        "latency_ms": elapsed_ms,
        "response_encoding_repaired": encoding_repaired,
        "thought_events_stripped": thought_events_stripped,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="运行 DocsGPT 真实全量评测")
    parser.add_argument(
        "--cases", type=Path, default=Path("evaluation/test_cases.json")
    )
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--base-url", default="http://127.0.0.1:7091")
    parser.add_argument("--api-key-env", default="DOCSGPT_AGENT_API_KEY")
    parser.add_argument("--chunks", type=int, default=2)
    parser.add_argument("--timeout", type=float, default=120.0)
    parser.add_argument("--case-id", action="append", help="只运行指定用例，可重复")
    parser.add_argument("--limit", type=int, help="最多运行多少条未完成用例")
    args = parser.parse_args()

    api_key = os.environ.get(args.api_key_env, "").strip()
    if not api_key:
        raise ValueError(f"环境变量 {args.api_key_env} 未设置。")
    if args.chunks < 1:
        raise ValueError("--chunks 必须大于 0。")

    cases = load_cases(args.cases)
    if args.case_id:
        selected = set(args.case_id)
        known = {case["id"] for case in cases}
        unknown = sorted(selected - known)
        if unknown:
            raise ValueError(f"未知用例：{', '.join(unknown)}")
        cases = [case for case in cases if case["id"] in selected]

    args.out.parent.mkdir(parents=True, exist_ok=True)
    completed = load_completed_ids(args.out)
    pending = [case for case in cases if case["id"] not in completed]
    if args.limit is not None:
        pending = pending[: args.limit]
    if not pending:
        print("没有待运行用例。")
        return 0

    with args.out.open("a", encoding="utf-8") as handle:
        for index, case in enumerate(pending, start=1):
            case_id = case["id"]
            print(f"[{index}/{len(pending)}] 正在运行 {case_id}...", flush=True)
            result = ask_docsgpt(
                base_url=args.base_url,
                api_key=api_key,
                question=case["question"],
                chunks=args.chunks,
                timeout=args.timeout,
            )
            record = {
                "case_id": case_id,
                "answer": result["answer"],
                "sources": result["sources"],
                "conversation_id": result["conversation_id"],
                "latency_ms": result["latency_ms"],
                "response_encoding_repaired": result["response_encoding_repaired"],
                "thought_events_stripped": result["thought_events_stripped"],
                "captured_at": datetime.now(timezone.utc).isoformat(),
            }
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")
            handle.flush()
            print(
                f"[{index}/{len(pending)}] 完成 {case_id}，"
                f"耗时 {result['latency_ms']} ms，来源 {len(result['sources'])} 个。",
                flush=True,
            )
    print(f"真实回答已写入：{args.out}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, RuntimeError, json.JSONDecodeError) as exc:
        print(f"运行失败：{exc}", file=sys.stderr)
        raise SystemExit(2)
