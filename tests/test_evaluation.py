from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def load_script(name: str):
    path = ROOT / "scripts" / f"{name}.py"
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


evaluate_rag = load_script("evaluate_rag")
run_docsgpt_evaluation = load_script("run_docsgpt_evaluation")


class EvaluateCaseTests(unittest.TestCase):
    def test_answer_case_reports_condition_and_source_failures(self):
        case = {
            "id": "T-001",
            "category": "售后",
            "question": "退款多久？",
            "expected_behavior": "answer",
            "required_patterns": ["1.*3", "工作日"],
            "source_hints": ["refund_policy"],
        }
        result = evaluate_rag.evaluate_case(
            case,
            {"answer": "请联系人工客服确认。", "sources": ["other.md"]},
        )
        self.assertFalse(result["overall_pass"])
        self.assertIn("answer_condition_miss", result["failure_types"])
        self.assertIn("unexpected_abstention", result["failure_types"])
        self.assertIn("source_citation_miss", result["failure_types"])

    def test_answer_case_requires_content_and_source_for_end_to_end_pass(self):
        case = {
            "id": "T-002",
            "category": "物流",
            "question": "多久发货？",
            "expected_behavior": "answer",
            "required_patterns": ["48.*小时"],
            "source_hints": ["shipping_policy"],
        }
        result = evaluate_rag.evaluate_case(
            case,
            {
                "answer": "普通商品会在48小时内发货。",
                "sources": ["shipping_policy.md"],
            },
        )
        self.assertTrue(result["answer_pass"])
        self.assertTrue(result["source_pass"])
        self.assertTrue(result["overall_pass"])
        self.assertEqual([], result["failure_types"])

    def test_boundary_case_reports_refusal_failure(self):
        case = {
            "id": "T-003",
            "category": "知识边界",
            "question": "支持海外退货吗？",
            "expected_behavior": "abstain",
            "abstain_patterns": ["未找到|人工客服"],
            "source_hints": [],
        }
        result = evaluate_rag.evaluate_case(
            case, {"answer": "支持，请直接寄回。", "sources": []}
        )
        self.assertFalse(result["overall_pass"])
        self.assertEqual(["boundary_refusal_miss"], result["failure_types"])

    def test_boundary_case_rejects_unsupported_extra_claims(self):
        case = {
            "id": "T-004",
            "category": "知识边界",
            "question": "人工客服是24小时吗？",
            "expected_behavior": "abstain",
            "abstain_patterns": ["未提及|联系人工客服"],
            "forbidden_patterns": ["基于一般常识|9:00"],
            "source_hints": [],
        }
        result = evaluate_rag.evaluate_case(
            case,
            {"answer": "知识库未提及。基于一般常识，客服通常9:00上线。", "sources": []},
        )
        self.assertFalse(result["overall_pass"])
        self.assertEqual(["unsupported_boundary_claim"], result["failure_types"])


class SourceNormalizationTests(unittest.TestCase):
    def test_source_names_supports_flat_and_nested_shapes(self):
        sources = [
            {"filename": "a.md"},
            {"metadata": {"source": "b.md"}},
            "c.md",
            {"title": "a.md"},
        ]
        self.assertEqual(
            ["a.md", "b.md", "c.md"],
            run_docsgpt_evaluation.source_names(sources),
        )

    def test_utf8_mojibake_is_repaired_without_changing_normal_chinese(self):
        original = "换货时同款商品缺货怎么办？"
        mojibake = original.encode("utf-8").decode("latin-1")
        repaired, changed = run_docsgpt_evaluation.repair_utf8_mojibake(mojibake)
        self.assertTrue(changed)
        self.assertEqual(original, repaired)
        unchanged, changed = run_docsgpt_evaluation.repair_utf8_mojibake(original)
        self.assertFalse(changed)
        self.assertEqual(original, unchanged)

    def test_only_leading_serialized_thought_events_are_removed(self):
        answer = (
            "{'type': 'thought', 'thought': '先检查\\n资料'}"
            "{'type': 'thought', 'thought': '再回答'}"
            "最终答案"
        )
        cleaned, count = run_docsgpt_evaluation.strip_serialized_thought_events(answer)
        self.assertEqual("最终答案", cleaned)
        self.assertEqual(2, count)
        ordinary = "回答中提到 {'type': 'thought'} 只是示例"
        cleaned, count = run_docsgpt_evaluation.strip_serialized_thought_events(ordinary)
        self.assertEqual(ordinary, cleaned)
        self.assertEqual(0, count)


if __name__ == "__main__":
    unittest.main()
