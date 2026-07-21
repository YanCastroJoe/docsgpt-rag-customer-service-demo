#!/usr/bin/env python3
"""Compare two real evaluation summaries from evaluate_rag.py."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


METRICS = [
    ("answer_complete_pass_rate", "回答完整通过率"),
    ("condition_coverage", "必答条件覆盖率"),
    ("source_citation_hit_rate", "来源引用命中率"),
    ("abstention_pass_rate", "知识边界拒答率"),
]


def load_summary(path: Path) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("schema_version") != "1.0" or not isinstance(data.get("metrics"), dict):
        raise ValueError(f"{path} 不是 evaluate_rag.py 生成的汇总文件。")
    return data


def format_rate(value: float | None) -> str:
    return "N/A" if value is None else f"{value:.1%}"


def main() -> int:
    parser = argparse.ArgumentParser(description="比较两次真实 RAG 评测结果")
    parser.add_argument("--baseline", type=Path, required=True, help="优化前 summary JSON")
    parser.add_argument("--candidate", type=Path, required=True, help="优化后 summary JSON")
    parser.add_argument("--out", type=Path, default=Path("evaluation/reports/comparison.md"))
    args = parser.parse_args()
    baseline, candidate = load_summary(args.baseline), load_summary(args.candidate)
    lines = [
        "# RAG 优化前后对比",
        "",
        "> 仅比较同一评测集、同一 Agent 配置口径下的真实运行结果。若任一指标为 N/A，说明该轮未提交对应类型的用例，不能据此得出优化结论。",
        "",
        f"- 优化前：`{args.baseline.as_posix()}`（提交 {baseline['submitted_cases']}/{baseline['total_cases']} 条）",
        f"- 优化后：`{args.candidate.as_posix()}`（提交 {candidate['submitted_cases']}/{candidate['total_cases']} 条）",
        "",
        "| 指标 | 优化前 | 优化后 | 变化 |",
        "| --- | --- | --- | --- |",
    ]
    for key, label in METRICS:
        before, after = baseline["metrics"].get(key), candidate["metrics"].get(key)
        delta = "N/A" if before is None or after is None else f"{(after - before) * 100:+.1f} pct"
        lines.append(f"| {label} | {format_rate(before)} | {format_rate(after)} | {delta} |")
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"已写入对比报告：{args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
