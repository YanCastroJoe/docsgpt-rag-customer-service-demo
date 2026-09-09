import importlib.util
import sys
import types
import unittest
from pathlib import Path


MODULE_PATH = (
    Path(__file__).resolve().parents[1]
    / "deployment"
    / "server"
    / "overrides"
    / "keyword_ranker.py"
)
SPEC = importlib.util.spec_from_file_location("keyword_ranker", MODULE_PATH)
KEYWORD_RANKER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(KEYWORD_RANKER)

SHARING_PATCH_PATH = (
    Path(__file__).resolve().parents[1]
    / "deployment"
    / "server"
    / "overrides"
    / "patch_sharing.py"
)
SHARING_SPEC = importlib.util.spec_from_file_location(
    "patch_sharing", SHARING_PATCH_PATH
)
SHARING_PATCH = importlib.util.module_from_spec(SHARING_SPEC)
SHARING_SPEC.loader.exec_module(SHARING_PATCH)

ANSWER_PATCH_PATH = (
    Path(__file__).resolve().parents[1]
    / "deployment"
    / "server"
    / "overrides"
    / "patch_answer_sources.py"
)
ANSWER_SPEC = importlib.util.spec_from_file_location(
    "patch_answer_sources", ANSWER_PATCH_PATH
)
ANSWER_PATCH = importlib.util.module_from_spec(ANSWER_SPEC)
ANSWER_SPEC.loader.exec_module(ANSWER_PATCH)


class FakeDocument:
    def __init__(self, text):
        self.page_content = text
        self.metadata = {}


class KeywordRankerTests(unittest.TestCase):
    def test_chinese_after_sales_query_ranks_exact_policy_first(self):
        documents = [
            FakeDocument("换货时同款商品缺货，提供退款或更换同价商品。"),
            FakeDocument("非质量问题退货由用户承担寄回运费。"),
            FakeDocument(
                "质量问题退货运费由平台承担；用户自行寄回时，"
                "普通快递最高报销 12 元。"
            ),
        ]

        ranked = KEYWORD_RANKER.rank_documents_by_keyword(
            "质量问题退货运费谁承担？普通快递最高报销多少？",
            documents,
            3,
        )

        self.assertIn("最高报销 12 元", ranked[0].page_content)

    def test_colloquial_defect_and_postage_query_ranks_policy_first(self):
        documents = [
            FakeDocument("纸质发票需要随退货商品一起寄回。"),
            FakeDocument("退款到账通常需要 1 到 3 个工作日。"),
            FakeDocument("质量问题退货运费由平台承担，普通快递最高报销 12 元。"),
        ]

        ranked = KEYWORD_RANKER.rank_documents_by_keyword(
            "东西有毛病，寄回去的钱谁出？普通快递最多给报多少？",
            documents,
            3,
        )

        self.assertIn("质量问题退货运费", ranked[0].page_content)
        self.assertIn("12 元", ranked[0].page_content)

    def test_boundary_query_ranks_boundary_rule_first(self):
        documents = [
            FakeDocument("普通商品付款后 48 小时内发货。"),
            FakeDocument("线下门店地址未在知识库说明，应联系人工客服确认。"),
        ]

        ranked = KEYWORD_RANKER.rank_documents_by_keyword(
            "离我最近的线下维修门店在哪？",
            documents,
            2,
        )

        self.assertIn("线下门店地址", ranked[0].page_content)

    def test_seven_day_no_reason_maps_to_non_quality_return_conditions(self):
        documents = [
            FakeDocument("质量问题需要在签收后十五日内提交申请。"),
            FakeDocument(
                "非质量问题退货由用户承担运费；商品外包装、配件、赠品、"
                "说明书需完整，不影响二次销售。"
            ),
        ]

        ranked = KEYWORD_RANKER.rank_documents_by_keyword(
            "七天无理由退货，商品需要满足什么条件？",
            documents,
            2,
        )

        self.assertIn("非质量问题退货", ranked[0].page_content)

    def test_exact_seven_day_policy_outranks_generic_return_conditions(self):
        documents = [
            FakeDocument("非质量问题退货由用户承担运费，商品需保持完整。"),
            FakeDocument(
                "七天无理由退货：签收次日零点起七日内申请，商品需保持完整。"
            ),
        ]

        ranked = KEYWORD_RANKER.rank_documents_by_keyword(
            "七天无理由退货需要满足什么条件？",
            documents,
            2,
        )

        self.assertIn("七天无理由退货", ranked[0].page_content)


class SharedAgentPatchTests(unittest.TestCase):
    def test_stream_source_patch_keeps_facts_after_100_characters(self):
        long_text = "质量问题退货运费" + ("说明" * 48) + "普通快递最高报销 12 元。"
        self.assertGreater(len(long_text), 100)
        source = ANSWER_PATCH.STREAM_SOURCE_OLD

        emitted_source = {"filename": "policy.md", "text": long_text}
        line = {"sources": [emitted_source]}

        def execute_stream_block(block):
            events = []

            def _emit(event):
                events.append(event)
                return event

            executable = block.replace('                elif "sources" in line:', "    if True:")
            executable = "def run(line, _mark_streaming_once, _emit):\n" + "\n".join(
                row[12:] if row.startswith(" " * 12) else row
                for row in executable.splitlines()
            )
            namespace = {}
            exec(executable, namespace)
            list(namespace["run"](line, lambda: None, _emit))
            return events[0]["source"][0]["text"]

        truncated_text = execute_stream_block(source)
        self.assertNotIn("12 元", truncated_text)
        self.assertTrue(truncated_text.endswith("..."))

        patched = ANSWER_PATCH.patch_stream_source(source)
        self.assertNotIn("[:100]", patched)
        self.assertIn('{"type": "source", "source": source_log_docs}', patched)
        complete_text = execute_stream_block(patched)
        self.assertEqual(long_text, complete_text)
        self.assertIn("12 元", complete_text)
        self.assertEqual(patched, ANSWER_PATCH.patch_stream_source(patched))

    def test_stream_source_patch_fails_closed_when_marker_is_missing(self):
        with self.assertRaisesRegex(RuntimeError, "streaming source marker"):
            ANSWER_PATCH.patch_stream_source("def unrelated():\n    return None\n")

    def test_multi_source_ids_are_added_to_shared_agent_payload(self):
        source = (
            "def serialize(agent):\n"
            "    source_id = agent.get('source_id')\n"
            "    return {\n"
            '        "source": str(source_id) if source_id else "",\n'
            '        "chunks": "2",\n'
            "    }\n"
        )

        patched = SHARING_PATCH.patch_source(source)

        self.assertIn('"sources": [', patched)
        self.assertIn('agent.get("extra_source_ids")', patched)

    def test_sync_api_clears_sources_for_knowledge_abstention(self):
        source = (
            "import logging\nimport traceback\n\n"
            "            stream_result = self.process_response_stream(stream)\n\n"
            + ANSWER_PATCH.OLD
        )

        patched = ANSWER_PATCH.patch_source(source)

        helpers = {}
        exec(compile(ANSWER_PATCH.IMPORT_NEW, "answer_helpers.py", "exec"), helpers)
        self.assertIn('stream_result["sources"] = []', patched)
        self.assertIn("当前知识库中未找到相关信息", patched)
        self.assertIn("_is_full_knowledge_abstention", patched)
        self.assertIn("_filter_answer_sources", patched)
        self.assertIn('re.escape(value)', patched)
        self.assertIn("_strip_serialized_thought_events", patched)
        refusal = "当前知识库中未找到相关信息，建议联系人工客服确认。"
        partial = "平台承担退货运费。\n" + refusal + "\n来源：示例.md · 运费"
        self.assertTrue(helpers["_is_full_knowledge_abstention"](refusal))
        self.assertFalse(helpers["_is_full_knowledge_abstention"](partial))
        self.assertEqual(ANSWER_PATCH.patch_source(patched), patched)

    def test_refusal_variants_clear_sources_but_partial_answer_keeps_match(self):
        helpers = {}
        exec(compile(ANSWER_PATCH.IMPORT_NEW, "answer_helpers.py", "exec"), helpers)
        variants = [
            "当前知识库中未找到相关信息，建议联系人工客服确认。",
            "当前知识库中未找到相关信息,建议联系人工客服确认.",
            " 当前知识库中未找到相关信息； 建议联系人工客服确认！ ",
            "当前知识库中未找到相关信息。建议联系人工客服确认。",
            "当前知识库中未找到相关信息 建议联系人工客服确认",
            "当前知识库中未找到相关信息！建议联系人工客服确认！",
        ]
        self.assertTrue(all(helpers["_is_full_knowledge_abstention"](item) for item in variants))
        self.assertTrue(helpers["_is_full_knowledge_abstention"](
            variants[0] + "\n来源：policy.md · 质量问题退货运费"
        ))
        partial = "平台承担运费。\n当前知识库中未找到相关信息，建议联系人工客服确认。\n来源：policy.md · 运费"
        self.assertFalse(helpers["_is_full_knowledge_abstention"](partial))
        inline_source = (
            "普通快递最高12元。来源：policy.md · 质量问题退货运费\n"
            "当前知识库中未找到相关信息，建议联系人工客服确认。"
        )
        self.assertFalse(helpers["_is_full_knowledge_abstention"](inline_source))

    def test_source_filter_fails_closed_and_keeps_only_explicit_chunk(self):
        helpers = {}
        exec(compile(ANSWER_PATCH.IMPORT_NEW, "answer_helpers.py", "exec"), helpers)
        chunks = [
            {"filename": "policy.md", "text": "运费规则\n平台承担运费"},
            {"filename": "policy.md", "text": "发票规则\n纸质发票寄回"},
        ]
        filter_sources = helpers["_filter_answer_sources"]
        self.assertEqual([], filter_sources("平台承担运费。", chunks))
        self.assertEqual([], filter_sources("来源：unknown.md · 未知", chunks))
        self.assertEqual([chunks[0]], filter_sources("来源：policy.md · 运费规则", chunks))

        ambiguous = [
            {"filename": "policy.md", "text": "相同章节\nA"},
            {"filename": "policy.md", "text": "相同章节\nB"},
        ]
        self.assertEqual([], filter_sources("来源：policy.md · 相同章节", ambiguous))
        self.assertEqual([], filter_sources("来源：policy.md", ambiguous))
        self.assertEqual(
            [],
            filter_sources("来源：a.md\n来源：相同章节", [
                {"filename": "a.md", "text": "相同章节\nA"},
                {"filename": "b.md", "text": "相同章节\nB"},
            ]),
        )

        distinct_files = [
            {"filename": "a.md", "text": "相同章节\nA"},
            {"filename": "b.md", "text": "相同章节\nB"},
        ]
        self.assertEqual(
            [distinct_files[0]],
            filter_sources("来源：a.md · 相同章节", distinct_files),
        )


class HybridRetrieverTests(unittest.TestCase):
    def test_rrf_candidates_are_capped_to_requested_chunks(self):
        classic_module = types.ModuleType("application.retriever.classic_rag")
        classic_module.ClassicRAG = object
        original = sys.modules.get("application.retriever.classic_rag")
        sys.modules["application.retriever.classic_rag"] = classic_module
        try:
            module_path = (
                Path(__file__).resolve().parents[1]
                / "deployment"
                / "server"
                / "overrides"
                / "hybrid_rag.py"
            )
            spec = importlib.util.spec_from_file_location("bounded_hybrid", module_path)
            hybrid = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(hybrid)
        finally:
            if original is None:
                sys.modules.pop("application.retriever.classic_rag", None)
            else:
                sys.modules["application.retriever.classic_rag"] = original

        class Store:
            def search(self, question, k):
                return [FakeDocument(f"vector-{index}") for index in range(k)]

            def keyword_search(self, question, k):
                return [FakeDocument(f"keyword-{index}") for index in range(k)]

        retriever = hybrid.HybridRetriever()
        results = retriever._fetch_candidates(Store(), "运费", 2, None)

        self.assertEqual(len(results), 2)

    def test_keyword_evidence_outweighs_a_broad_vector_neighbour(self):
        quality = FakeDocument(
            "质量问题退货运费由平台承担，普通快递最高报销 12 元。"
        )
        broad = FakeDocument("非质量问题退货由用户承担运费。")
        classic_module = types.ModuleType("application.retriever.classic_rag")
        classic_module.ClassicRAG = object
        original = sys.modules.get("application.retriever.classic_rag")
        sys.modules["application.retriever.classic_rag"] = classic_module
        try:
            module_path = (
                Path(__file__).resolve().parents[1]
                / "deployment/server/overrides/hybrid_rag.py"
            )
            spec = importlib.util.spec_from_file_location(
                "weighted_hybrid", module_path
            )
            hybrid = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(hybrid)
            ranked = hybrid.reciprocal_rank_fusion(
                [broad] + [FakeDocument(f"semantic-{index}") for index in range(4)] + [quality],
                [quality, broad],
            )
        finally:
            if original is None:
                sys.modules.pop("application.retriever.classic_rag", None)
            else:
                sys.modules["application.retriever.classic_rag"] = original

        self.assertIs(ranked[0], quality)


if __name__ == "__main__":
    unittest.main()
