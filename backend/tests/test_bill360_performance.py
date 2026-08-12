import unittest

from app.api.bill360_performance import Bill360QuickSdkKey, Bill360QuickSdkRequest, bill360_quicksdk_summary


class _RowsResult:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return list(self._rows)


class _FakeDb:
    def __init__(self, rows):
        self.rows = rows
        self.execute_count = 0

    def execute(self, _stmt):
        self.execute_count += 1
        return _RowsResult(self.rows)


class Bill360QuickSdkPerformanceTest(unittest.TestCase):
    def test_multiple_bill_lines_are_aggregated_with_one_database_query(self):
        db = _FakeDb([
            ("2026-01", "龙吟大陆005折混服", "巴兔", 100.25),
            ("2026-01", "龙吟大陆005专服2", "重庆星游", 200.75),
            ("2026-01", "云上征途 taptap", "巴兔", 300.00),
            ("2026-02", "龙吟大陆005折混服", "巴兔", 999.00),
            ("2026-01", "无关产品", "巴兔", 777.00),
        ])
        payload = Bill360QuickSdkRequest(keys=[
            Bill360QuickSdkKey(key="2026-01::龙吟大陆", settlement_month="2026-01", game_name="龙吟大陆"),
            Bill360QuickSdkKey(key="2026-01::云上征途", settlement_month="2026-01", game_name="云上征途"),
        ])

        result = bill360_quicksdk_summary(payload, db)

        self.assertEqual(db.execute_count, 1)
        items = {item["key"]: item for item in result["items"]}
        dragon = items["2026-01::龙吟大陆"]
        cloud = items["2026-01::云上征途"]

        self.assertEqual(dragon["row_count"], 2)
        self.assertEqual(dragon["channel_count"], 2)
        self.assertEqual(dragon["source_game_count"], 2)
        self.assertEqual(dragon["total_flow"], 301.0)
        self.assertEqual(dragon["top_channel"], "重庆星游")
        self.assertEqual(dragon["top_channel_flow"], 200.75)

        self.assertEqual(cloud["row_count"], 1)
        self.assertEqual(cloud["total_flow"], 300.0)
        self.assertEqual(cloud["top_channel"], "巴兔")

    def test_empty_keys_do_not_query_database(self):
        db = _FakeDb([])
        result = bill360_quicksdk_summary(Bill360QuickSdkRequest(keys=[]), db)
        self.assertEqual(result, {"items": []})
        self.assertEqual(db.execute_count, 0)


if __name__ == "__main__":
    unittest.main()
