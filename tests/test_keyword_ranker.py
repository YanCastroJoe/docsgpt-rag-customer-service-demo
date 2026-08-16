import importlib.util
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


class FakeDocument:
    def __init__(self, text):
        self.page_content = text


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


class SharedAgentPatchTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
