#!/usr/bin/env python3
"""Build a static, privacy-safe RAG evaluation observability snapshot."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

try:
    from evaluate_rag import evaluate_case
except ModuleNotFoundError:  # pragma: no cover - used when imported as a module
    from scripts.evaluate_rag import evaluate_case


def read_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    if not isinstance(payload, dict):
        raise ValueError(f"{path} 必须包含 JSON 对象。")
    return payload


def read_jsonl(path: Path) -> dict[str, dict[str, Any]]:
    records: dict[str, dict[str, Any]] = {}
    with path.open("r", encoding="utf-8") as handle:
        for line_no, raw_line in enumerate(handle, start=1):
            if not raw_line.strip():
                continue
            record = json.loads(raw_line)
            case_id = record.get("case_id")
            if not isinstance(case_id, str) or not case_id:
                raise ValueError(f"{path}:{line_no} 缺少 case_id。")
            records[case_id] = record
    return records


def resolve_repo_path(root: Path, value: str) -> Path:
    candidate = (root / value).resolve()
    root_resolved = root.resolve()
    if root_resolved != candidate and root_resolved not in candidate.parents:
        raise ValueError(f"路径超出仓库范围：{value}")
    return candidate


def compact_text(value: Any, limit: int = 220) -> str:
    text = " ".join(str(value or "").split())
    return text if len(text) <= limit else f"{text[: limit - 1]}…"


def percent(value: Any) -> float | None:
    if not isinstance(value, (int, float)):
        return None
    return round(float(value) * 100, 1)


def build_snapshot(root: Path, manifest_path: Path) -> dict[str, Any]:
    manifest = read_json(manifest_path)
    runs = manifest.get("runs")
    if not isinstance(runs, list) or not runs:
        raise ValueError("run_manifest.json 必须至少包含一轮评测。")

    run_summaries = []
    for run in runs:
        summary = read_json(resolve_repo_path(root, run["summary"]))
        metrics = summary.get("metrics", {})
        run_summaries.append(
            {
                "label": run["label"],
                "captured_at": run.get("captured_at"),
                "submitted": summary.get("submitted_cases"),
                "end_to_end_pass_rate": percent(metrics.get("end_to_end_pass_rate")),
                "condition_coverage": percent(metrics.get("condition_coverage")),
                "source_hit_rate": percent(metrics.get("source_citation_hit_rate")),
                "boundary_pass_rate": percent(metrics.get("abstention_pass_rate")),
            }
        )

    latest = runs[-1]
    latest_summary = read_json(resolve_repo_path(root, latest["summary"]))
    cases_payload = read_json(resolve_repo_path(root, manifest["evaluation_set"]))
    cases = cases_payload.get("cases")
    if not isinstance(cases, list):
        raise ValueError("评测集缺少 cases 数组。")
    responses = read_jsonl(resolve_repo_path(root, latest["responses"]))

    traces = []
    for case in cases:
        result = evaluate_case(case, responses.get(case["id"]))
        traces.append(
            {
                "id": result["id"],
                "category": result["category"],
                "question": result["question"],
                "expected_behavior": result["expected_behavior"],
                "overall_pass": result.get("overall_pass", False),
                "condition_coverage": percent(result.get("condition_coverage")),
                "source_pass": result.get("source_pass", False),
                "sources": result.get("sources", []),
                "latency_ms": result.get("latency_ms"),
                "answer_excerpt": compact_text(result.get("answer")),
                "failure_types": result.get("failure_types", []),
            }
        )

    metrics = latest_summary.get("metrics", {})
    latency = latest_summary.get("latency_metrics", {})
    return {
        "schema_version": "1.0",
        "mode": "fixed_evaluation_snapshot",
        "notice": "数据来自固定评测集的真实 API 回答快照，不是生产流量或实时内部 Trace。",
        "latest_run": {
            "label": latest["label"],
            "captured_at": latest.get("captured_at"),
            "submitted": latest_summary.get("submitted_cases"),
            "answer_cases": latest_summary.get("answer_cases_submitted"),
            "boundary_cases": latest_summary.get("abstain_cases_submitted"),
            "end_to_end_pass_rate": percent(metrics.get("end_to_end_pass_rate")),
            "condition_coverage": percent(metrics.get("condition_coverage")),
            "source_hit_rate": percent(metrics.get("source_citation_hit_rate")),
            "boundary_pass_rate": percent(metrics.get("abstention_pass_rate")),
            "p50_ms": latency.get("p50_ms"),
            "p95_ms": latency.get("p95_ms"),
            "failure_counts": latest_summary.get("failure_counts", {}),
        },
        "pipeline": [
            {"key": "query", "label": "用户问题", "detail": "独立会话，避免上下文串扰"},
            {"key": "retrieve", "label": "Hybrid Retrieval", "detail": "FAISS + 中文关键词 RRF"},
            {"key": "context", "label": "Context", "detail": "Sources 与知识边界 Prompt"},
            {"key": "generate", "label": "LLM Answer", "detail": "基于召回片段生成回答"},
            {"key": "verify", "label": "Rule Verifier", "detail": "条件、来源、拒答与扩写检查"},
        ],
        "runs": run_summaries,
        "traces": traces,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--manifest", default="evaluation/run_manifest.json")
    parser.add_argument(
        "--out", default="deployment/server/frontend/ops/data.json"
    )
    args = parser.parse_args()
    root = args.root.resolve()
    payload = build_snapshot(root, resolve_repo_path(root, args.manifest))
    output = resolve_repo_path(root, args.out)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"已生成 RAG 可观测快照：{output}")


if __name__ == "__main__":
    main()
