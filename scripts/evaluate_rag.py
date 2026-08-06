#!/usr/bin/env python3
"""Evaluate real DocsGPT RAG answers with transparent deterministic rules.

The evaluator never calls an LLM. It scores answers captured from DocsGPT and
reports observable failure symptoms. Root causes such as retrieval failure or
prompt-context loss still require trace inspection and manual confirmation.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


UNEXPECTED_ABSTENTION_PATTERNS = [
    r"(知识库|资料|文档).{0,12}(未找到|没有|未提供|未说明|不包含)",
    r"(无法|不能).{0,8}(确认|回答|判断|提供)",
    r"(建议|请).{0,8}(联系|咨询).{0,8}(人工)?客服",
]

FAILURE_LABELS = {
    "missing_response": "回答缺失",
    "empty_answer": "回答为空",
    "answer_condition_miss": "必答条件遗漏",
    "unexpected_abstention": "知识命中题误拒答",
    "source_citation_miss": "来源引用未命中",
    "boundary_refusal_miss": "知识边界拒答失败",
    "unsupported_boundary_claim": "知识边界无依据扩写",
}


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


def contains_unexpected_abstention(answer: str) -> bool:
    return any(
        re.search(pattern, answer, flags=re.IGNORECASE | re.DOTALL)
        for pattern in UNEXPECTED_ABSTENTION_PATTERNS
    )


def evaluate_case(case: dict[str, Any], response: dict[str, Any] | None) -> dict[str, Any]:
    result: dict[str, Any] = {
        "id": case["id"],
        "category": case["category"],
        "question": case["question"],
        "expected_behavior": case["expected_behavior"],
    }
    if response is None:
        result.update(
            {
                "status": "missing",
                "answer_pass": False,
                "source_pass": False,
                "overall_pass": False,
                "failure_types": ["missing_response"],
            }
        )
        return result

    answer = str(response.get("answer", response.get("response", ""))).strip()
    sources = normalize_sources(response.get("sources"))
    result.update(
        {
            "status": "scored",
            "answer": answer,
            "sources": sources,
            "latency_ms": response.get("latency_ms"),
            "conversation_id": response.get("conversation_id"),
            "response_encoding_repaired": bool(
                response.get("response_encoding_repaired")
            ),
            "thought_events_stripped": int(
                response.get("thought_events_stripped") or 0
            ),
        }
    )
    failures: list[str] = []
    if not answer:
        failures.append("empty_answer")

    if case["expected_behavior"] == "answer":
        patterns = case["required_patterns"]
        hit, missed = pattern_hits(answer, patterns)
        result["matched_patterns"] = hit
        result["missed_patterns"] = missed
        result["condition_coverage"] = len(hit) / len(patterns)
        result["answer_pass"] = bool(answer) and not missed
        if missed:
            failures.append("answer_condition_miss")
            if contains_unexpected_abstention(answer):
                failures.append("unexpected_abstention")

        hints = [hint.lower() for hint in case.get("source_hints", [])]
        source_text = " ".join(sources).lower()
        result["source_pass"] = bool(hints) and any(
            hint in source_text for hint in hints
        )
        if not result["source_pass"]:
            failures.append("source_citation_miss")
    else:
        patterns = case["abstain_patterns"]
        hit, missed = pattern_hits(answer, patterns)
        forbidden_patterns = case.get("forbidden_patterns", [])
        forbidden_hit, _ = pattern_hits(answer, forbidden_patterns)
        result["matched_patterns"] = hit
        result["missed_patterns"] = missed
        result["forbidden_patterns_hit"] = forbidden_hit
        result["condition_coverage"] = len(hit) / len(patterns)
        result["answer_pass"] = bool(answer) and bool(hit) and not forbidden_hit
        result["source_pass"] = True
        if forbidden_hit:
            failures.append("unsupported_boundary_claim")
        elif not result["answer_pass"]:
            failures.append("boundary_refusal_miss")

    result["overall_pass"] = result["answer_pass"] and result["source_pass"]
    result["failure_types"] = list(dict.fromkeys(failures))
    return result


def build_summary(
    results: list[dict[str, Any]], cases_path: Path, responses_path: Path
) -> dict[str, Any]:
    submitted = [item for item in results if item["status"] == "scored"]
    answer_cases = [
        item for item in submitted if item["expected_behavior"] == "answer"
    ]
    abstain_cases = [
        item for item in submitted if item["expected_behavior"] == "abstain"
    ]
    answer_passes = sum(item["answer_pass"] for item in submitted)
    end_to_end_passes = sum(item["overall_pass"] for item in submitted)
    source_passes = sum(item["source_pass"] for item in answer_cases)
    abstain_passes = sum(item["answer_pass"] for item in abstain_cases)
    coverage = sum(item.get("condition_coverage", 0) for item in submitted)
    failure_counts = Counter(
        failure
        for item in results
        for failure in item.get("failure_types", [])
    )

    category_metrics: dict[str, dict[str, Any]] = {}
    for category in sorted({item["category"] for item in results}):
        category_items = [
            item
            for item in submitted
            if item["category"] == category
        ]
        category_metrics[category] = {
            "submitted": len(category_items),
            "end_to_end_passes": sum(
                item["overall_pass"] for item in category_items
            ),
            "end_to_end_pass_rate": (
                sum(item["overall_pass"] for item in category_items)
                / len(category_items)
                if category_items
                else None
            ),
        }

    latencies = sorted(
        int(item["latency_ms"])
        for item in submitted
        if isinstance(item.get("latency_ms"), (int, float))
    )
    latency_metrics = {
        "sample_count": len(latencies),
        "average_ms": round(sum(latencies) / len(latencies)) if latencies else None,
        "p50_ms": (
            latencies[math.ceil(0.50 * len(latencies)) - 1] if latencies else None
        ),
        "p95_ms": (
            latencies[math.ceil(0.95 * len(latencies)) - 1] if latencies else None
        ),
        "max_ms": max(latencies) if latencies else None,
    }
    collection_diagnostics = {
        "encoding_repaired_answers": sum(
            bool(item.get("response_encoding_repaired"))
            for item in submitted
        ),
        "answers_with_stripped_thought_events": sum(
            int(item.get("thought_events_stripped") or 0) > 0
            for item in submitted
        ),
        "thought_events_stripped_total": sum(
            int(item.get("thought_events_stripped") or 0)
            for item in submitted
        ),
    }

    return {
        "schema_version": "1.1",
        "cases_file": cases_path.as_posix(),
        "responses_file": responses_path.as_posix(),
        "total_cases": len(results),
        "submitted_cases": len(submitted),
        "answer_cases_submitted": len(answer_cases),
        "abstain_cases_submitted": len(abstain_cases),
        "metrics": {
            "answer_complete_pass_rate": (
                answer_passes / len(submitted) if submitted else None
            ),
            "condition_coverage": coverage / len(submitted) if submitted else None,
            "source_citation_hit_rate": (
                source_passes / len(answer_cases) if answer_cases else None
            ),
            "abstention_pass_rate": (
                abstain_passes / len(abstain_cases) if abstain_cases else None
            ),
            "end_to_end_pass_rate": (
                end_to_end_passes / len(submitted) if submitted else None
            ),
        },
        "failure_counts": dict(sorted(failure_counts.items())),
        "category_metrics": category_metrics,
        "latency_metrics": latency_metrics,
        "collection_diagnostics": collection_diagnostics,
    }


def format_rate(value: float | None) -> str:
    return "N/A" if value is None else f"{value:.1%}"


def render_report(results: list[dict[str, Any]], summary: dict[str, Any]) -> str:
    metrics = summary["metrics"]
    latency = summary["latency_metrics"]
    diagnostics = summary["collection_diagnostics"]
    rows = []
    for item in results:
        verdict = "通过" if item.get("overall_pass") else "待复核"
        failures = item.get("failure_types", [])
        notes = "、".join(FAILURE_LABELS.get(code, code) for code in failures) or "-"
        rows.append(
            f"| {item['id']} | {item['category']} | "
            f"{item['expected_behavior']} | {verdict} | {notes} |"
        )

    failure_rows = [
        f"| {FAILURE_LABELS.get(code, code)} | {count} |"
        for code, count in summary["failure_counts"].items()
    ]
    if not failure_rows:
        failure_rows = ["| 无 | 0 |"]

    category_rows = []
    for category, data in summary["category_metrics"].items():
        category_rows.append(
            f"| {category} | {data['submitted']} | {data['end_to_end_passes']} | "
            f"{format_rate(data['end_to_end_pass_rate'])} |"
        )

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
            f"- 回答完整通过率：{format_rate(metrics['answer_complete_pass_rate'])}",
            f"- 必答条件覆盖率：{format_rate(metrics['condition_coverage'])}",
            f"- 来源引用命中率（仅知识命中题）：{format_rate(metrics['source_citation_hit_rate'])}",
            f"- 知识边界拒答率：{format_rate(metrics['abstention_pass_rate'])}",
            f"- 端到端通过率（回答与来源同时通过）：{format_rate(metrics['end_to_end_pass_rate'])}",
            "",
            "> 说明：本报告只评估真实回答的可观察结果。失败分类描述的是症状，不能单凭规则判定检索、知识库或 Prompt 是根因；根因需结合 Sources、Prompt 与运行记录人工复核。",
            "",
            "## 运行与采集诊断",
            "",
            f"- 延迟样本：{latency['sample_count']} 条",
            f"- 平均延迟：{latency['average_ms'] if latency['average_ms'] is not None else 'N/A'} ms",
            f"- P50 / P95 / 最大延迟：{latency['p50_ms'] if latency['p50_ms'] is not None else 'N/A'} / {latency['p95_ms'] if latency['p95_ms'] is not None else 'N/A'} / {latency['max_ms'] if latency['max_ms'] is not None else 'N/A'} ms",
            f"- 响应编码修复：{diagnostics['encoding_repaired_answers']} 条",
            f"- 剥离序列化 thought 事件：{diagnostics['answers_with_stripped_thought_events']} 条回答，共 {diagnostics['thought_events_stripped_total']} 个事件",
            "",
            "## 失败分类",
            "",
            "| 失败类型 | 次数 |",
            "| --- | ---: |",
            *failure_rows,
            "",
            "## 分类结果",
            "",
            "| 类别 | 已提交 | 端到端通过 | 通过率 |",
            "| --- | ---: | ---: | ---: |",
            *category_rows,
            "",
            "## 用例明细",
            "",
            "| 用例 | 类别 | 预期行为 | 结果 | 失败分类 |",
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
            raise ValueError(
                f"{case['id']} 的 expected_behavior 必须为 answer 或 abstain。"
            )
        key = (
            "required_patterns"
            if case["expected_behavior"] == "answer"
            else "abstain_patterns"
        )
        if not isinstance(case.get(key), list) or not case[key]:
            raise ValueError(f"{case['id']} 必须提供非空 {key}。")
        for pattern in case[key]:
            re.compile(pattern)
        forbidden_patterns = case.get("forbidden_patterns", [])
        if not isinstance(forbidden_patterns, list):
            raise ValueError(f"{case['id']} 的 forbidden_patterns 必须为数组。")
        for pattern in forbidden_patterns:
            re.compile(pattern)
        known_ids.add(case["id"])


def write_template(cases: list[dict[str, Any]], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for case in cases:
            line = {
                "case_id": case["id"],
                "answer": "请替换为从 DocsGPT 页面或 API 导出的真实回答。",
                "sources": ["请替换为页面显示的来源文件名。"],
            }
            handle.write(json.dumps(line, ensure_ascii=False) + "\n")


def main() -> int:
    parser = argparse.ArgumentParser(description="DocsGPT RAG 离线评测器")
    parser.add_argument(
        "--cases", type=Path, default=Path("evaluation/test_cases.json")
    )
    parser.add_argument("--responses", type=Path, help="真实回答导出的 JSONL 文件")
    parser.add_argument(
        "--out", type=Path, default=Path("evaluation/reports/latest.md")
    )
    parser.add_argument(
        "--summary-json", type=Path, help="写入机器可读评测汇总 JSON"
    )
    parser.add_argument(
        "--init-template", type=Path, help="生成可填写的回答 JSONL 模板"
    )
    parser.add_argument(
        "--validate-only", action="store_true", help="仅校验评测集结构与正则"
    )
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
        args.summary_json.write_text(
            json.dumps(summary, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(f"已写入评测汇总：{args.summary_json}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"评测失败：{exc}", file=sys.stderr)
        raise SystemExit(2)
