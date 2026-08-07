import unittest

from fastapi.testclient import TestClient

from contract_ai.main import app as contract_ai_app, format_internal_contract_no
from contract_ai.extraction import (
    extract_output_text,
    normalize_contract_scan_result,
    normalize_date,
)


class ContractSmartScanTest(unittest.TestCase):
    def test_normalize_chinese_date(self):
        self.assertEqual(normalize_date("2026年4月16日"), "2026-04-16")
        self.assertEqual(normalize_date("2027/4/15"), "2027-04-15")

    def test_normalize_sample_like_result(self):
        fields = {
            "contract_name": "《魔法启示录》合作协议",
            "contract_type": "无固定总价合同",
            "document_type": "master",
            "amount": "0.00",
            "counterparty": "海南奇趣网络科技有限公司",
            "contract_no": "",
            "signing_date": "2026年4月16日",
            "signing_status": "已签署",
            "effective_date": "2026年4月16日",
            "end_date": "2027年4月15日",
            "performance_status": "履行中",
            "payment_type": "收款",
        }
        raw = {
            "contract": fields,
            "confidence": {key: 0.95 for key in fields},
            "evidence": {key: "合同原文" for key in fields},
            "parties": {
                "party_a": "海南奇趣网络科技有限公司",
                "party_b": "广州熊动科技有限公司",
                "our_party": "广州熊动科技有限公司",
            },
            "access_items": [
                {
                    "values": {
                        "product_name": "魔法启示录",
                        "channel_name": "快手直播",
                        "agreement_type": "联合运营",
                        "authorization_start": "2026-04-16",
                        "authorization_end": "2027-04-15",
                        "share_rate": "",
                        "channel_fee_rate": "",
                        "platform": "",
                        "status": "生效",
                        "remarks": "CPA 10元/新增注册用户；自然月结算；6%增值税专票",
                    },
                    "confidence": {
                        "product_name": 0.99,
                        "channel_name": 0.92,
                        "agreement_type": 0.9,
                        "authorization_start": 0.99,
                        "authorization_end": 0.99,
                        "share_rate": 0.1,
                        "channel_fee_rate": 0.1,
                        "platform": 0.2,
                        "status": 0.8,
                        "remarks": 0.95,
                    },
                    "evidence": {key: "合同原文" for key in (
                        "product_name", "channel_name", "agreement_type",
                        "authorization_start", "authorization_end", "share_rate",
                        "channel_fee_rate", "platform", "status", "remarks"
                    )},
                }
            ],
            "summary": "按新增注册用户结算的合作协议",
            "warnings": ["未发现合同编号"],
        }
        result = normalize_contract_scan_result(raw)
        self.assertEqual(result["contract"]["amount"], "")
        self.assertEqual(result["contract"]["effective_date"], "2026-04-16")
        self.assertEqual(result["contract"]["end_date"], "2027-04-15")
        self.assertEqual(result["access_items"][0]["values"]["product_name"], "魔法启示录")

    def test_smart_scan_requires_authentication(self):
        client = TestClient(contract_ai_app)
        response = client.post(
            "/api/contracts/smart-scan",
            content=b"fake-pdf",
            headers={
                "X-File-Name": "sample.pdf",
                "Content-Type": "application/pdf",
            },
        )
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json().get("detail"), "请先登录")

    def test_internal_number_list_requires_authentication(self):
        client = TestClient(contract_ai_app)
        response = client.get("/api/contracts/internal-numbers")
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json().get("detail"), "请先登录")

    def test_internal_contract_number_format(self):
        self.assertEqual(format_internal_contract_no("202608", 1), "HT-202608-0001")
        self.assertEqual(format_internal_contract_no("202604", 27), "HT-202604-0027")
        with self.assertRaises(ValueError):
            format_internal_contract_no("2026-08", 1)
        with self.assertRaises(ValueError):
            format_internal_contract_no("202608", 0)

    def test_extract_responses_output_text(self):
        payload = {
            "output": [
                {
                    "type": "message",
                    "content": [
                        {"type": "output_text", "text": '{"ok": true}'}
                    ],
                }
            ]
        }
        self.assertEqual(extract_output_text(payload), '{"ok": true}')


if __name__ == "__main__":
    unittest.main()
