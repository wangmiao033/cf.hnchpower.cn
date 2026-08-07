"""合同智能录入的结构化提取规则与结果清洗。"""

from __future__ import annotations

import json
import re
from typing import Any

CONTRACT_FIELDS = (
    "contract_name",
    "contract_type",
    "document_type",
    "amount",
    "counterparty",
    "contract_no",
    "signing_date",
    "signing_status",
    "effective_date",
    "end_date",
    "performance_status",
    "payment_type",
)

ACCESS_FIELDS = (
    "product_name",
    "channel_name",
    "agreement_type",
    "authorization_start",
    "authorization_end",
    "share_rate",
    "channel_fee_rate",
    "platform",
    "status",
    "remarks",
)

DATE_FIELDS = {"signing_date", "effective_date", "end_date", "authorization_start", "authorization_end"}
DOCUMENT_TYPES = {"master", "supplement", "transfer", "other"}

SYSTEM_PROMPT = """
你是财务系统的合同智能录入助手。请读取用户上传的合同原件（可能是扫描版 PDF、盖章扫描件或图片），只依据文件中真实可见的内容提取信息，不要使用常识补全未出现的信息。

系统主体通常为“广州熊动科技有限公司”。若合同双方中明确出现该公司，则 counterparty 应填写另一方；若无法确定系统主体，不要猜测 counterparty，并在 warnings 中说明。

字段规则：
1. contract_name：合同标题，尽量保留原合同书名号/名称。
2. contract_type：按真实计价方式判断。固定总额才写“固定总价合同”；按流水、CPA、注册量、分成、实际结算等方式计费应写“无固定总价合同”或更贴切的按量/分成类型，绝不能只因 WPS/模板默认值写成固定总价。
3. document_type：主合同 master；补充协议 supplement；转让/主体变更 transfer；其他 other。
4. amount：仅在合同有明确固定合同总额时填写纯数字字符串；按量、按分成、CPA 等无固定总额的合同留空。
5. 日期统一 YYYY-MM-DD。无法确认就留空。
6. signing_status：有双方签字/盖章可写“已签署”；无明确签署证据留空。
7. performance_status：仍在有效期内且已签署可建议“履行中”；不能从文件确认则留空。
8. payment_type：从“广州熊动科技有限公司”的角度判断，钱流入我方填“收款”，我方向对方支付填“付款”，双向或无法判断留空。
9. access_items：若合同明确涉及游戏/产品、渠道/合作平台、授权期、分成/费率等，则提取为游戏接入清单。不要把 CPA 单价误写为 share_rate；这类信息写进 remarks。
10. evidence：必须是简短的原文依据或所在条款摘要，用于人工复核。没有依据就留空。
11. confidence：0~1。明确写在合同中的字段应高；通过上下文推断的字段应低于 0.8；无法确认则字段值留空且置信度低。
12. warnings：列出需要人工确认的歧义、缺失字段或可能识别错误。

输出必须严格符合 JSON Schema，不要输出合同原文全文，不要输出 Markdown。
""".strip()


def _value_map_schema(keys: tuple[str, ...], value_schema: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "object",
        "properties": {key: value_schema for key in keys},
        "required": list(keys),
        "additionalProperties": False,
    }


CONTRACT_SCAN_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "contract": _value_map_schema(CONTRACT_FIELDS, {"type": "string"}),
        "confidence": _value_map_schema(CONTRACT_FIELDS, {"type": "number", "minimum": 0, "maximum": 1}),
        "evidence": _value_map_schema(CONTRACT_FIELDS, {"type": "string"}),
        "parties": {
            "type": "object",
            "properties": {
                "party_a": {"type": "string"},
                "party_b": {"type": "string"},
                "our_party": {"type": "string"},
            },
            "required": ["party_a", "party_b", "our_party"],
            "additionalProperties": False,
        },
        "access_items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "values": _value_map_schema(ACCESS_FIELDS, {"type": "string"}),
                    "confidence": _value_map_schema(ACCESS_FIELDS, {"type": "number", "minimum": 0, "maximum": 1}),
                    "evidence": _value_map_schema(ACCESS_FIELDS, {"type": "string"}),
                },
                "required": ["values", "confidence", "evidence"],
                "additionalProperties": False,
            },
        },
        "summary": {"type": "string"},
        "warnings": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["contract", "confidence", "evidence", "parties", "access_items", "summary", "warnings"],
    "additionalProperties": False,
}


def clean_text(value: Any, *, limit: int = 2000) -> str:
    text = str(value or "").strip()
    text = re.sub(r"\s+", " ", text)
    return text[:limit]


def normalize_date(value: Any) -> str:
    text = clean_text(value, limit=64)
    if not text:
        return ""
    match = re.search(r"(?P<y>20\d{2})\s*[年./\-/]\s*(?P<m>\d{1,2})\s*[月./\-/]\s*(?P<d>\d{1,2})\s*日?", text)
    if not match:
        return text if re.fullmatch(r"20\d{2}-\d{2}-\d{2}", text) else ""
    year = int(match.group("y"))
    month = int(match.group("m"))
    day = int(match.group("d"))
    if not 1 <= month <= 12 or not 1 <= day <= 31:
        return ""
    return f"{year:04d}-{month:02d}-{day:02d}"


def normalize_confidence(value: Any) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    return round(min(1.0, max(0.0, number)), 3)


def normalize_contract_scan_result(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise ValueError("智能识别结果不是有效对象")

    contract_raw = raw.get("contract") if isinstance(raw.get("contract"), dict) else {}
    confidence_raw = raw.get("confidence") if isinstance(raw.get("confidence"), dict) else {}
    evidence_raw = raw.get("evidence") if isinstance(raw.get("evidence"), dict) else {}

    contract: dict[str, str] = {}
    confidence: dict[str, float] = {}
    evidence: dict[str, str] = {}
    for key in CONTRACT_FIELDS:
        value = clean_text(contract_raw.get(key), limit=1000)
        if key in DATE_FIELDS:
            value = normalize_date(value)
        if key == "document_type":
            value = value.lower()
            if value not in DOCUMENT_TYPES:
                value = "master" if not value else "other"
        if key == "amount":
            value = re.sub(r"[^0-9.\-]", "", value)
            if value in {"0", "0.0", "0.00", "-0", "-0.0"}:
                value = ""
        contract[key] = value
        confidence[key] = normalize_confidence(confidence_raw.get(key))
        evidence[key] = clean_text(evidence_raw.get(key), limit=500)

    parties_raw = raw.get("parties") if isinstance(raw.get("parties"), dict) else {}
    parties = {
        "party_a": clean_text(parties_raw.get("party_a"), limit=500),
        "party_b": clean_text(parties_raw.get("party_b"), limit=500),
        "our_party": clean_text(parties_raw.get("our_party"), limit=500),
    }

    access_items: list[dict[str, Any]] = []
    for item in raw.get("access_items") or []:
        if not isinstance(item, dict):
            continue
        values_raw = item.get("values") if isinstance(item.get("values"), dict) else {}
        item_confidence = item.get("confidence") if isinstance(item.get("confidence"), dict) else {}
        item_evidence = item.get("evidence") if isinstance(item.get("evidence"), dict) else {}
        values: dict[str, str] = {}
        confidences: dict[str, float] = {}
        evidences: dict[str, str] = {}
        for key in ACCESS_FIELDS:
            value = clean_text(values_raw.get(key), limit=1000)
            if key in DATE_FIELDS:
                value = normalize_date(value)
            values[key] = value
            confidences[key] = normalize_confidence(item_confidence.get(key))
            evidences[key] = clean_text(item_evidence.get(key), limit=500)
        if values.get("product_name") or values.get("channel_name"):
            access_items.append({"values": values, "confidence": confidences, "evidence": evidences})

    warnings = [clean_text(item, limit=500) for item in raw.get("warnings") or [] if clean_text(item, limit=500)]
    return {
        "contract": contract,
        "confidence": confidence,
        "evidence": evidence,
        "parties": parties,
        "access_items": access_items[:20],
        "summary": clean_text(raw.get("summary"), limit=1200),
        "warnings": warnings[:20],
    }


def extract_output_text(response_payload: Any) -> str:
    if not isinstance(response_payload, dict):
        return ""
    direct = response_payload.get("output_text")
    if isinstance(direct, str) and direct.strip():
        return direct.strip()
    for item in response_payload.get("output") or []:
        if not isinstance(item, dict):
            continue
        for content in item.get("content") or []:
            if not isinstance(content, dict):
                continue
            if content.get("type") == "output_text" and isinstance(content.get("text"), str):
                text = content["text"].strip()
                if text:
                    return text
    return ""


def parse_model_json(response_payload: Any) -> dict[str, Any]:
    text = extract_output_text(response_payload)
    if not text:
        raise ValueError("模型没有返回结构化内容")
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError("模型返回的结构化内容无法解析") from exc
