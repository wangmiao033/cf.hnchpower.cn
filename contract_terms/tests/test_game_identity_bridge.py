import unittest
from pathlib import Path

from game_identity import (
    enrich_candidates_with_game_ids,
    enrich_lines_with_game_ids,
    normalize_registry_game,
)


class _Result:
    def __init__(self, *, one=None, rows=None):
        self._one = one
        self._rows = rows or []

    def fetchone(self):
        return self._one

    def fetchall(self):
        return self._rows


class _FakeConnection:
    def execute(self, sql, params=None):
        statement = str(sql)
        params = params or []
        if "to_regclass" in statement:
            name = str(params[0]).removeprefix("public.")
            existing = {
                "game_registry_games",
                "game_registry_aliases",
                "contract_access_game_links",
            }
            return _Result(one={"name": name if name in existing else None})

        if "FROM game_registry_games" in statement and "normalized_name = ANY" in statement:
            rows = []
            for key in params[0]:
                if key == normalize_registry_game("一起来修仙（0.05折）"):
                    rows.append(
                        {
                            "normalized_alias": key,
                            "game_id": "G-XIUXIAN-005",
                            "canonical_name": "一起来修仙（0.05折）",
                        }
                    )
            return _Result(rows=rows)

        if "FROM game_registry_aliases AS alias" in statement:
            rows = []
            for key in params[0]:
                if key == normalize_registry_game("一起来修仙渠道版"):
                    rows.append(
                        {
                            "normalized_alias": key,
                            "game_id": "G-XIUXIAN-005",
                            "canonical_name": "一起来修仙（0.05折）",
                        }
                    )
            return _Result(rows=rows)

        if "FROM contract_access_game_links" in statement:
            rows = []
            for access_id in params[0]:
                if access_id == "ACCESS-3733-XIUXIAN":
                    rows.append(
                        {"access_item_id": access_id, "game_id": "G-XIUXIAN-005"}
                    )
            return _Result(rows=rows)

        if "SELECT id, canonical_name" in statement and "FROM game_registry_games" in statement:
            rows = []
            for game_id in params[0]:
                if game_id == "G-XIUXIAN-005":
                    rows.append(
                        {"id": game_id, "canonical_name": "一起来修仙（0.05折）"}
                    )
            return _Result(rows=rows)

        return _Result(rows=[])


class GameIdentityBridgeTests(unittest.TestCase):
    def test_typography_normalization_keeps_commercial_version(self):
        self.assertEqual(
            normalize_registry_game(" 一起来修仙（0.05折） "),
            normalize_registry_game("一起来修仙(0.05折)"),
        )
        self.assertNotEqual(
            normalize_registry_game("一起来修仙（0.05折）"),
            normalize_registry_game("一起来修仙（3折）"),
        )

    def test_bill_line_resolves_to_stable_game_id_and_canonical_name(self):
        [line] = enrich_lines_with_game_ids(
            _FakeConnection(),
            [{"game_name": "一起来修仙(0.05折)", "settlement_cycle": "2026-07"}],
        )
        self.assertEqual(line["game_id"], "G-XIUXIAN-005")
        self.assertEqual(line["game_name"], "一起来修仙（0.05折）")
        self.assertEqual(line["input_game_name"], "一起来修仙(0.05折)")

    def test_persistent_alias_resolves_to_same_game_id(self):
        [line] = enrich_lines_with_game_ids(
            _FakeConnection(),
            [{"game_name": "一起来修仙渠道版", "settlement_cycle": "2026-07"}],
        )
        self.assertEqual(line["game_id"], "G-XIUXIAN-005")
        self.assertEqual(line["game_name"], "一起来修仙（0.05折）")

    def test_contract_access_link_overrides_contract_display_name(self):
        [candidate] = enrich_candidates_with_game_ids(
            _FakeConnection(),
            [
                {
                    "access_item_id": "ACCESS-3733-XIUXIAN",
                    "product_name": "一起来修仙",
                    "share_rate": 25,
                }
            ],
        )
        self.assertEqual(candidate["game_id"], "G-XIUXIAN-005")
        self.assertEqual(candidate["product_name"], "一起来修仙（0.05折）")
        self.assertEqual(candidate["original_product_name"], "一起来修仙")
        self.assertEqual(candidate["share_rate"], 25)

    def test_production_endpoint_routes_through_registry_before_contract_matcher(self):
        root = Path(__file__).resolve().parents[1]
        source = (root / "contract_terms" / "v12_main.py").read_text(encoding="utf-8")
        self.assertIn("enrich_candidates_with_game_ids", source)
        self.assertIn("enrich_lines_with_game_ids", source)
        self.assertIn("_extended.recommend_channel_rules", source)
        self.assertIn('"mode": "registry-first"', source)

    def test_migration_only_backfills_identity_not_financial_values(self):
        root = Path(__file__).resolve().parents[1]
        source = (root / "backend" / "sql" / "062_game_identity_contract_bridge.sql").read_text(encoding="utf-8")
        self.assertIn("contract_access_game_links", source)
        self.assertIn("game_registry_aliases", source)
        self.assertIn("ADD COLUMN IF NOT EXISTS game_id", source)
        self.assertNotIn("SET share_rate", source)
        self.assertNotIn("SET tax_rate", source)
        self.assertNotIn("SET channel_fee_rate", source)


if __name__ == "__main__":
    unittest.main()
