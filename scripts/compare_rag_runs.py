#!/usr/bin/env python3
"""Compare two or more real RAG evaluation summaries."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


METRICS = [
    ("answer_complete_pass_rate", "回答完整通过率"),
    ("condition_coverage", "必答条件覆盖率"),
    ("source_citation_hit_rate", "来源文件命中率"),
    ("abstention_pass_rate", "知识边界拒答率"),
    ("end_to_end_pass_rate", "端到端通过率"),
]

FAILURE_LABELS = {
    "missing_response": "回答缺失",
    "empty_answer": "回答为空",
    "answer_condition_miss": "必答条件遗漏",
    "unexpected_abstention": "知识命中题误拒答",
    "source_citation_miss": "来源文件未命中",
    "boundary_refusal_miss": "知识边界拒答失败",
    "unsupported_boundary_claim": "知识边界无依据扩写",
}


def load_summary(path: Path) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("schema_version") not in {"1.0", "1.1"} or not isinstance(
        data.get("metrics"), dict
    ):
        raise ValueError(f"{path} 不是 evaluate_rag.py 生成的汇总文件。")
    return data


def parse_run(value: str) -> tuple[str, Path]:
    label, separator, raw_path = value.partition("=")
    if not separator or not label.strip() or not raw_path.strip():
        raise argparse.ArgumentTypeError("--run 必须使用 标签=summary.json 格式")
    return label.strip(), Path(raw_path.strip())


def format_rate(value: float | None) -> str:
    return "N/A" if value is None else f"{value:.1%}"


def main() -> int:
    parser = argparse.ArgumentParser(description="比较多次真实 RAG 评测结果")
    parser.add_argument(
        "--run",
        action="append",
        type=parse_run,
        help="可重复传入，格式为 标签=summary.json",
    )
    parser.add_argument("--baseline", type=Path, help="兼容旧用法：优化前汇总")
    parser.add_argument("--candidate", type=Path, help="兼容旧用法：优化后汇总")
    parser.add_argument(
        "--out", type=Path, default=Path("evaluation/reports/comparison.md")
    )
    args = parser.parse_args()

    run_specs = args.run or []
    if not run_specs:
        if not args.baseline or not args.candidate:
            parser.error("请至少提供两个 --run，或同时提供 --baseline 与 --candidate。")
        run_specs = [("优化前", args.baseline), ("优化后", args.candidate)]
    if len(run_specs) < 2:
        parser.error("至少需要两次评测结果才能比较。")

    labels = [label for label, _ in run_specs]
    if len(labels) != len(set(labels)):
        parser.error("--run 标签不能重复。")
    runs = [(label, path, load_summary(path)) for label, path in run_specs]

    lines = [
        "# RAG 多版本评测对比",
        "",
        "> 仅比较同一评测集、同一模型与 Prompt 配置下的真实运行结果。N/A 表示该轮汇总未提供该指标，不能据此得出优化结论。",
        "",
        "## 运行信息",
        "",
        "| 版本 | 汇总文件 | 已提交 |",
        "| --- | --- | ---: |",
    ]
    for label, path, summary in runs:
        lines.append(
            f"| {label} | `{path.as_posix()}` | "
            f"{summary['submitted_cases']}/{summary['total_cases']} |"
        )

    lines.extend(
        [
            "",
            "## 指标对比",
            "",
            "| 指标 | " + " | ".join(labels) + " |",
            "| --- | " + " | ".join("---:" for _ in labels) + " |",
        ]
    )
    for key, metric_label in METRICS:
        values = [format_rate(summary["metrics"].get(key)) for _, _, summary in runs]
        lines.append(f"| {metric_label} | " + " | ".join(values) + " |")

    lines.extend(
        [
            "",
            "## 失败症状对比",
            "",
            "| 失败类型 | " + " | ".join(labels) + " |",
            "| --- | " + " | ".join("---:" for _ in labels) + " |",
        ]
    )
    failure_types = sorted(
        {
            failure
            for _, _, summary in runs
            for failure in summary.get("failure_counts", {})
        }
    )
    if failure_types:
        for failure in failure_types:
            counts = [
                str(summary.get("failure_counts", {}).get(failure, 0))
                for _, _, summary in runs
            ]
            lines.append(
                f"| {FAILURE_LABELS.get(failure, failure)} | "
                + " | ".join(counts)
                + " |"
            )
    else:
        lines.append("| 无可比数据 | " + " | ".join("0" for _ in labels) + " |")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"已写入对比报告：{args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
