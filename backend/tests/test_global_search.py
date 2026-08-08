import unittest

from app.schemas.global_search import GlobalSearchResponse
from app.services.global_search import _clean_query, _rank_fields, search_business_data


class NeverQueryDb:
    def execute(self, *_args, **_kwargs):
        raise AssertionError("global search must not query unauthorized module data")


class GlobalSearchTest(unittest.TestCase):
    def test_query_cleanup_removes_like_wildcards_and_trims_length(self):
        self.assertEqual(_clean_query("  HT-202608_0001%  "), "HT-202608 0001")
        self.assertEqual(len(_clean_query("A" * 300)), 120)

    def test_exact_identifier_match_ranks_first(self):
        score, matched = _rank_fields(
            "HT-202608-0001",
            [
                ("我司合同编号", "HT-202608-0001"),
                ("合同名称", "某游戏联合运营协议"),
            ],
            identifier_fields={"我司合同编号"},
        )
        self.assertEqual(score, 100)
        self.assertEqual(matched, ["我司合同编号"])

    def test_normalized_chinese_company_match_ignores_common_punctuation(self):
        score, matched = _rank_fields(
            "上海圆戏网络科技有限公司",
            [
                ("签约方", "上海圆戏网络科技（有限公司）"),
                ("游戏", "魔法启示录"),
            ],
        )
        self.assertGreaterEqual(score, 88)
        self.assertEqual(matched, ["签约方"])

    def test_no_permissions_returns_empty_without_business_queries(self):
        payload = search_business_data(NeverQueryDb(), set(), "魔法启示录")
        self.assertEqual(payload["query"], "魔法启示录")
        self.assertEqual(payload["total"], 0)
        self.assertEqual(payload["results"], [])
        self.assertEqual(payload["groups"], [])

    def test_response_schema_accepts_direct_navigation_target(self):
        payload = {
            "query": "HT-202608-0001",
            "total": 1,
            "groups": [{"kind": "contract", "count": 1}],
            "results": [
                {
                    "id": "contract:c-1",
                    "kind": "contract",
                    "title": "手机游戏联合运营合作协议",
                    "subtitle": "上海圆戏网络科技有限公司",
                    "meta": "HT-202608-0001",
                    "badge": "合同",
                    "score": 100,
                    "matched_fields": ["我司合同编号"],
                    "target": {
                        "action": "contract_detail",
                        "view": "contracts",
                        "entity_id": "c-1",
                    },
                }
            ],
        }
        parsed = GlobalSearchResponse.model_validate(payload)
        self.assertEqual(parsed.results[0].target.action, "contract_detail")
        self.assertEqual(parsed.results[0].score, 100)


if __name__ == "__main__":
    unittest.main()
