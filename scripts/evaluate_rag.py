#!/usr/bin/env python3
"""Evaluate exported DocsGPT RAG answers against a transparent local test set.

The evaluator deliberately does not call an LLM or DocsGPT. It scores real
answers copied from the UI/API, keeping reported metrics reproducible.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def read_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    if not isinstance(payload, dict) or not isinstance(payload.get("cases"), list):
        raise ValueError("评测集必须是包含 cases 数组的 JSON 文件。")
    return payload


def read_jsonl(path: Path) -> dict[str, dict[str, Any]]:
    records: dict[str, dict[str, Any]] = {}
    with path.open("r", encoding="utf-8") as handle:
        for line_no, raw_line in enumerate(handle, start=1):
            line = raw_line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(f"{path}:{line_no} 不是有效 JSON：{exc.msg}") from exc
            case_id = record.get("case_id")
            if not isinstance(case_id, str) or not case_id:
                raise ValueError(f"{path}:{line_no} 缺少非空 case_id。")
            if case_id in records:
                raise ValueError(f"{path}:{line_no} 的 case_id 重复：{case_id}")
            records[case_id] = record
    return records


def normalize_sources(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value]
    if isinstance(value, list):
        result: list[str] = []
        for item in value:
            if isinstance(item, str):
                result.append(item)
            elif isinstance(item, dict):
                result.append(" ".join(str(v) for v in item.values()))
            else:
                result.append(str(item))
        return result
    return [str(value)]


def pattern_hits(text: str, patterns: list[str]) -> tuple[list[str], list[str]]:
    hit, missed = [], []
    for pattern in patterns:
        if re.search(pattern, text, flags=re.IGNORECASE | re.DOTALL):
            hit.append(pattern)
        else:
            missed.append(pattern)
    return hit, missed


def evaluate_case(case: dict[str, Any], response: dict[str, Any] | None) -> dict[str, Any]:
    result: dict[str, Any] = {
        "id": case["id"],
        "category": case["category"],
        "question": case["question"],
        "expected_behavior": case["expected_behavior"],
    }
    if response is None:
        result.update({"status": "missing", "answer_pass": False, "source_pass": False})
        return result

    answer = str(response.get("answer", response.get("response", ""))).strip()
    sources = normalize_sources(response.get("sources"))
    result.update({"status": "scored", "answer": answer, "sources": sources})

    if case["expected_behavior"] == "answer":
        patterns = case["required_patterns"]
        hit, missed = pattern_hits(answer, patterns)
        result["matched_patterns"] = hit
        result["missed_patterns"] = missed
        result["condition_coverage"] = len(hit) / len(patterns)
        result["answer_pass"] = not missed
        hints = [hint.lower() for hint in case.get("source_hints", [])]
        source_text = " ".join(sources).lower()
        result["source_pass"] = bool(hints) and any(hint in source_text for hint in hints)
    else:
        patterns = case["abstain_patterns"]
        hit, missed = pattern_hits(answer, patterns)
        result["matched_patterns"] = hit
        result["missed_patterns"] = missed
        result["condition_coverage"] = len(hit) / len(patterns)
        result["answer_pass"] = bool(hit)
        result["source_pass"] = True
    return result


def percentage(numerator: int | float, denominator: int | float) -> str:
    if not denominator:
        return "N/A"
    return f"{numerator / denominator:.1%}"


def build_summary(results: list[dict[str, Any]], cases_path: Path, responses_path: Path) -> dict[str, Any]:
    submitted = [item for item in results if item["status"] == "scored"]
    answer_cases = [item for item in submitted if item["expected_behavior"] == "answer"]
    abstain_cases = [item for item in submitted if item["expected_behavior"] == "abstain"]
    answer_passes = sum(item["answer_pass"] for item in submitted)
    source_passes = sum(item["source_pass"] for item in answer_cases)
    abstain_passes = sum(item["answer_pass"] for item in abstain_cases)
    coverage = sum(item.get("condition_coverage", 0) for item in submitted)
    return {
        "schema_version": "1.0",
        "cases_file": cases_path.as_posix(),
        "responses_file": responses_path.as_posix(),
        "total_cases": len(results),
        "submitted_cases": len(submitted),
        "answer_cases_submitted": len(answer_cases),
        "abstain_cases_submitted": len(abstain_cases),
        "metrics": {
            "answer_complete_pass_rate": answer_passes / len(submitted) if submitted else None,
            "condition_coverage": coverage / len(submitted) if submitted else None,
            "source_citation_hit_rate": source_passes / len(answer_cases) if answer_cases else None,
            "abstention_pass_rate": abstain_passes / len(abstain_cases) if abstain_cases else None,
        },
    }


def render_report(results: list[dict[str, Any]], summary: dict[str, Any]) -> str:
    submitted = [item for item in results if item["status"] == "scored"]
    metrics = summary["metrics"]
    rows = []
    for item in results:
        if item["status"] == "missing":
            verdict = "未提交"
            notes = "-"
        else:
            verdict = "通过" if item["answer_pass"] and item["source_pass"] else "待复核"
            missed = item.get("missed_patterns", [])
            notes = "；".join(missed) if missed else "-"
        rows.append(f"| {item['id']} | {item['category']} | {item['expected_behavior']} | {verdict} | {notes} |")

    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    return "\n".join(
        [
            "# RAG 离线评测报告",
            "",
            f"生成时间：{now}",
            "",
            "## 结果摘要",
            "",
            f"- 评测集：`{summary['cases_file']}`",
            f"- 回答导出：`{summary['responses_file']}`",
            f"- 用例总数：{summary['total_cases']}",
            f"- 已提交回答：{summary['submitted_cases']}",
            f"- 回答完整通过率：{percentage(metrics['answer_complete_pass_rate'] or 0, 1) if metrics['answer_complete_pass_rate'] is not None else 'N/A'}",
            f"- 必答条件覆盖率：{percentage(metrics['condition_coverage'] or 0, 1) if metrics['condition_coverage'] is not None else 'N/A'}",
            f"- 来源引用命中率（仅必答题）：{percentage(metrics['source_citation_hit_rate'] or 0, 1) if metrics['source_citation_hit_rate'] is not None else 'N/A'}",
            f"- 知识边界拒答率：{percentage(metrics['abstention_pass_rate'] or 0, 1) if metrics['abstention_pass_rate'] is not None else 'N/A'}",
            "",
            "> 说明：该脚本只评测人工导出的真实回答；未提交的用例不会被计入上述比例。正则规则用于可复查的基础验收，不替代人工质检。",
            "",
            "## 用例明细",
            "",
            "| 用例 | 类别 | 预期行为 | 结果 | 未命中条件 |",
            "| --- | --- | --- | --- | --- |",
            *rows,
            "",
        ]
    )


def validate_cases(cases: list[dict[str, Any]]) -> None:
    required = {"id", "category", "question", "expected_behavior", "source_hints"}
    known_ids: set[str] = set()
    for index, case in enumerate(cases, start=1):
        missing = required.difference(case)
        if missing:
            raise ValueError(f"第 {index} 条用例缺少字段：{', '.join(sorted(missing))}")
        if case["id"] in known_ids:
            raise ValueError(f"用例 ID 重复：{case['id']}")
        if case["expected_behavior"] not in {"answer", "abstain"}:
            raise ValueError(f"{case['id']} 的 expected_behavior 必须为 answer 或 abstain。")
        key = "required_patterns" if case["expected_behavior"] == "answer" else "abstain_patterns"
        if not isinstance(case.get(key), list) or not case[key]:
            raise ValueError(f"{case['id']} 必须提供非空 {key}。")
        for pattern in case[key]:
            re.compile(pattern)
        known_ids.add(case["id"])


def write_template(cases: list[dict[str, Any]], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for case in cases:
            line = {
                "case_id": case["id"],
                "answer": "请替换为从 DocsGPT 页面或 API 导出的真实回答。",
                "sources": ["请替换为页面展示的来源文件名。"],
            }
            handle.write(json.dumps(line, ensure_ascii=False) + "\n")


def main() -> int:
    parser = argparse.ArgumentParser(description="DocsGPT RAG 离线评测器")
    parser.add_argument("--cases", type=Path, default=Path("evaluation/test_cases.json"))
    parser.add_argument("--responses", type=Path, help="真实回答导出的 JSONL 文件")
    parser.add_argument("--out", type=Path, default=Path("evaluation/reports/latest.md"))
    parser.add_argument("--summary-json", type=Path, help="写入供优化前后比较的机器可读汇总 JSON")
    parser.add_argument("--init-template", type=Path, help="生成可填写的回答 JSONL 模板")
    parser.add_argument("--validate-only", action="store_true", help="仅校验评测集结构与正则表达式")
    args = parser.parse_args()

    payload = read_json(args.cases)
    cases = payload["cases"]
    validate_cases(cases)
    print(f"评测集校验通过：{len(cases)} 条用例。")

    if args.init_template:
        write_template(cases, args.init_template)
        print(f"已生成回答模板：{args.init_template}")
    if args.validate_only:
        return 0
    if not args.responses:
        parser.error("执行评分时必须提供 --responses；或使用 --validate-only。")

    responses = read_jsonl(args.responses)
    known_ids = {case["id"] for case in cases}
    unknown_ids = sorted(set(responses).difference(known_ids))
    if unknown_ids:
        raise ValueError(f"回答文件包含未知 case_id：{', '.join(unknown_ids)}")
    results = [evaluate_case(case, responses.get(case["id"])) for case in cases]
    summary = build_summary(results, args.cases, args.responses)
    report = render_report(results, summary)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(report, encoding="utf-8")
    print(f"已写入评测报告：{args.out}")
    if args.summary_json:
        args.summary_json.parent.mkdir(parents=True, exist_ok=True)
        args.summary_json.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"已写入评测汇总：{args.summary_json}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"评测失败：{exc}", file=sys.stderr)
        raise SystemExit(2)
