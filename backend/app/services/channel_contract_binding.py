"""Atomic channel-line contract evidence, using the existing link table only.

No financial calculations or contract-library writes belong in this module.
Original line IDs, never game names or array positions, identify existing links.
"""
from __future__ import annotations

import calendar
import json
import math
import re
import unicodedata
from datetime import date
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import bindparam, inspect, text

from app.services.channel_settlement_engine import resolve_rule_settings

LINE_BINDING_FIELDS = {"id", "contract_access_item_id"}
_HARD_INVALID = {
    "停用", "已停用", "禁用", "已禁用", "作废", "已作废", "取消", "已取消",
    "disabled", "cancelled", "canceled", "void", "voided",
}


def _blocked(code: str, message: str):
    raise HTTPException(409, detail={"error": code, "message": message})


def _normalized(value) -> str:
    return unicodedata.normalize("NFKC", str(value or "")).strip().lower()


def _label(value) -> str:
    return re.sub(r"\s+", "", _normalized(value))


def _split_platform(value) -> tuple[str, str]:
    raw = _normalized(value)
    match = re.search(r"(?:[-_\s](ios|android)|\((ios|android)\))$", raw)
    return (raw[:match.start()].strip(), match.group(1) or match.group(2)) if match else (raw, "")


def _game_key(value) -> str:
    raw = re.sub(r"[()\[\]【】\s]", "", _normalized(value))

    def discount(match):
        token = match.group(0)[:-1]
        if re.fullmatch(r"0\d+", token):
            token = "0." + token[1:]
        return f"{float(token):g}折"

    return re.sub(r"(?<!\d)\d+(?:\.\d+)?折", discount, raw)


def contract_game_matches(game_name, candidate: dict) -> bool:
    """Formatting/platform aliases cannot erase a distinct commercial edition."""
    game, device = _split_platform(game_name)
    product, product_device = _split_platform(candidate.get("product_name"))
    if not _game_key(game) or _game_key(game) != _game_key(product):
        return False
    declared = _normalized(candidate.get("platform"))
    all_platforms = declared in {"全版本", "all", "all platforms"}
    platforms = {"android", "ios"} if re.fullmatch(r"(?:android\s*/\s*ios|ios\s*/\s*android)", declared) else {declared}
    if product_device:
        return bool(device and device == product_device and
                    (not declared or all_platforms or device in platforms))
    if not device:
        return declared not in {"android", "ios"}
    return all_platforms or device in platforms


def _channel_matches(bill_channel, candidate_channel, short_name) -> bool:
    def channel_key(value):
        # Mirror the production recommender's channel formatting normalization.
        return re.sub(r"[\s·,，.。\-_/\\:：]", "", _normalized(value))

    left, right = channel_key(bill_channel), channel_key(candidate_channel)
    if not left or not right or left == right:
        return True
    # The current, linked customer record is the only alias authority.
    raw = _normalized(short_name)
    decorated = re.fullmatch(r"([^()]+)\(([^()]+)\)", raw)
    if not decorated:
        return False
    trusted = {channel_key(raw), channel_key(decorated.group(1))}
    inner = decorated.group(2).strip()
    numeric = re.fullmatch(r"(\d{3,8})(?:(?:集团|平台|渠道)|(?:[\s\\/|,、_\-]*集网)|[\s\\/|,、_\-]*)?", inner)
    if numeric:
        trusted.add(numeric.group(1))
    return left in trusted and right in trusted


def validate_contract_binding(bill, line, candidate: dict, partner: dict) -> None:
    if str(candidate.get("partner_id") or "") != str(partner.get("id") or ""):
        _blocked("channel_contract_wrong_customer", "所选合同不属于当前客户，未保存任何修改。")
    if not _channel_matches(bill.channel_name, candidate.get("channel_name"), partner.get("short_name")):
        _blocked("channel_contract_wrong_channel", "所选合同渠道与账单不一致，请核对客户库渠道简称。")
    if not contract_game_matches(line.game_name, candidate):
        _blocked("channel_contract_wrong_game", "所选合作清单的游戏、商业版本或终端平台与账单不一致。")
    statuses = {_label(candidate.get(key)) for key in ("access_status", "performance_status")}
    if statuses & _HARD_INVALID:
        _blocked("channel_contract_inactive", "所选合同或合作清单已停用、取消或作废，请重新选择。")
    cycle = str(line.settlement_cycle or bill.settlement_month or "")
    if not re.fullmatch(r"20\d{2}-(?:0[1-9]|1[0-2])", cycle):
        _blocked("channel_contract_period_missing", "请选择有效结算月份后再引用合同。")
    start, end = candidate.get("authorization_start"), candidate.get("authorization_end")
    try:
        start = date.fromisoformat(str(start)[:10]) if start else None
        end = date.fromisoformat(str(end)[:10]) if end else None
    except ValueError:
        _blocked("channel_contract_period_invalid", "合同授权日期无效，请先核对原合同合作清单。")
    if not start and not end:
        _blocked("channel_contract_period_missing", "合同授权期尚未录入，不能固化本账期合同依据。")
    year, month = map(int, cycle.split("-"))
    first, last = date(year, month, 1), date(year, month, calendar.monthrange(year, month)[1])
    if (start and end and start > end) or (start and start > last) or (end and end < first):
        _blocked("channel_contract_out_of_period", "当前结算月份不在所选合同授权期内。")
    for field in ("share_rate", "channel_fee_rate"):
        try:
            rate = float(candidate.get(field))
            valid = math.isfinite(rate) and 0 <= rate <= 100
        except (ValueError, TypeError):
            valid = False
        if not valid:
            _blocked("channel_contract_rule_incomplete", "所选合作清单缺少有效分成或通道费，请先核对合同。")
    # Preserve the submitted money fields, but never certify a different rule.
    # A platform-amount discrepancy must remain a discrepancy, not a zero fee.
    share = float(candidate["share_rate"])
    fee = float(candidate["channel_fee_rate"])
    # Use the existing engine's resolved mode, not raw fields: a share_only
    # code ignores an apparently present percent fee in the submitted payload.
    effective = resolve_rule_settings(line, bill)
    mode, line_fee = effective["fee_mode"], effective["fee_rate"]
    try:
        matches_fee = (
            (fee <= 0.01 and mode == "none" and (line_fee is None or abs(float(line_fee)) <= 0.01))
            or (mode == "percent" and line_fee is not None and abs(float(line_fee) - fee) <= 0.0001)
        )
        matches_share = abs(float(line.share_rate) - share) <= 0.0001
    except (ValueError, TypeError):
        matches_fee, matches_share = False, False
    if not matches_share or not matches_fee:
        _blocked("channel_contract_rule_changed", "本行分成或通道费与所选合作清单不一致，请重新应用原合同规则；平台金额差异需另行核对。")


def _has_links(db) -> bool:
    # Schema installation is not a side effect of reading or saving a bill.
    if db.get_bind().dialect.name == "postgresql":
        return bool(db.execute(text("SELECT to_regclass('public.cf_bill_contract_links')")).scalar())
    return inspect(db.connection()).has_table("cf_bill_contract_links")


def load_channel_contract_links(db, bill_ids: list[str]) -> dict[str, dict[str, dict]]:
    if not bill_ids or not _has_links(db):
        return {}
    query = text("""
        SELECT * FROM cf_bill_contract_links
        WHERE bill_type = 'channel' AND bill_id IN :bill_ids
    """).bindparams(bindparam("bill_ids", expanding=True))
    result = {}
    for row in db.execute(query, {"bill_ids": bill_ids}).mappings():
        result.setdefault(str(row["bill_id"]), {})[str(row["line_id"])] = dict(row)
    return result


def prepare_channel_contract_bindings(db, bill, submitted, existing_lines, *, preserve_ids: bool):
    """Validate before financial mutation; return links indexed by submitted row."""
    existing = {str(line.id): line for line in existing_lines}
    seen = set()
    ids = []
    for item in submitted:
        line_id = str(item.id or "").strip()
        # A synthetic legacy display row has no physical line to inherit.
        if not existing and line_id == f"legacy-{bill.id}":
            line_id = ""
        if line_id and (line_id not in existing or line_id in seen):
            _blocked("channel_contract_line_identity_invalid", "账单明细 ID 不属于本单或重复，请重新载入账单后保存。")
        if line_id:
            seen.add(line_id)
        ids.append(line_id)
    old = load_channel_contract_links(db, [str(bill.id)]).get(str(bill.id), {})
    live_old = {line_id: link for line_id, link in old.items() if line_id in existing}
    desired = []
    for index, (item, line_id) in enumerate(zip(submitted, ids)):
        # A completely unchanged legacy payload can preserve the physical IDs.
        if not line_id and preserve_ids and index < len(existing_lines):
            line_id = str(existing_lines[index].id)
        prior = live_old.get(line_id)
        explicit = "contract_access_item_id" in item.model_fields_set
        if explicit:
            access_id = str(item.contract_access_item_id or "").strip()
        else:
            access_id = str((prior or {}).get("access_item_id") or "")
        desired.append(dict(prior) if prior and access_id == prior.get("access_item_id")
                       else {"access_item_id": access_id} if access_id else None)
    # Without IDs we cannot distinguish repeated games or safely carry evidence.
    all_links_explicit = all("contract_access_item_id" in item.model_fields_set for item in submitted)
    if live_old and not preserve_ids and not any(ids) and not all_links_explicit:
        _blocked("channel_contract_line_identity_required", "账单已有合同关联，请重新载入后保存，不能按行号猜配原合同依据。")
    if not any(desired):
        return desired, old
    if not _has_links(db):
        _blocked("channel_contract_storage_unavailable", "合同关联存储尚不可用，本次账单未保存，请联系管理员。")
    lock = " FOR SHARE" if db.get_bind().dialect.name == "postgresql" else ""
    partners = db.execute(text("""
        SELECT id, name, short_name FROM cf_partner_records
        WHERE name = :name OR short_name = :name
    """ + lock), {"name": str(bill.partner_name or "").strip()}).mappings().all()
    if len(partners) != 1:
        _blocked("channel_contract_customer_ambiguous", "当前合作方未唯一关联客户库，请重新选择准确客户后保存。")
    partner = dict(partners[0])
    cache = {}
    for item, link in zip(submitted, desired):
        if not link:
            continue
        access_id = str(link["access_item_id"])
        if access_id not in cache:
            candidate_lock = " FOR SHARE OF access, contract" if lock else ""
            row = db.execute(text("""
                SELECT access.id AS access_item_id, access.product_name,
                       access.channel_name, access.platform, access.authorization_start,
                       access.authorization_end, access.share_rate, access.channel_fee_rate,
                       access.status AS access_status, contract.partner_id,
                       contract.performance_status
                FROM cf_contract_access_items AS access
                JOIN cf_contract_records AS contract ON contract.id = access.contract_id
                WHERE access.id = :id
            """ + candidate_lock), {"id": access_id}).mappings().first()
            if row is None:
                _blocked("channel_contract_missing", "原合同合作清单已删除，请重新选择或解除本行关联后保存。")
            cache[access_id] = dict(row)
        validate_contract_binding(bill, item, cache[access_id], partner)
    return desired, old


def save_channel_contract_bindings(db, bill_id, saved_lines, desired, previous) -> None:
    current = {str(line.id): link for line, link in zip(saved_lines, desired) if link}
    if ({key: str(value["access_item_id"]) for key, value in current.items()} ==
            {key: str(value["access_item_id"]) for key, value in previous.items()}):
        return
    if not current and not previous:
        return
    db.execute(text("DELETE FROM cf_bill_contract_links WHERE bill_type = 'channel' AND bill_id = :bill"),
               {"bill": str(bill_id)})
    actor = str((db.info.get("audit_actor") or {}).get("user_id") or "")
    for line_id, link in current.items():
        db.execute(text("""
            INSERT INTO cf_bill_contract_links
              (bill_type, bill_id, line_id, access_item_id, match_method, note,
               confirmed_by, confirmed_at, created_at, updated_at)
            VALUES ('channel', :bill, :line, :access, :method, :note, :actor,
                    COALESCE(:confirmed_at, CURRENT_TIMESTAMP),
                    COALESCE(:created_at, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP)
        """), {
            "bill": str(bill_id), "line": line_id, "access": str(link["access_item_id"]),
            "method": link.get("match_method") or "manual",
            "note": link.get("note") or "账单页引用现有合作清单；随账单保存并核验",
            "actor": link.get("confirmed_by") or actor,
            "confirmed_at": link.get("confirmed_at"), "created_at": link.get("created_at"),
        })
    # Immutable operation_logs retain the previous evidence even when a line is
    # replaced, removed, or explicitly unbound. This is part of the same commit.
    changes = {
        "contract_bindings": {
            "before": {key: str(value["access_item_id"]) for key, value in previous.items()},
            "after": {key: str(value["access_item_id"]) for key, value in current.items()},
        },
    }
    json_changes = "CAST(:changes AS jsonb)" if db.get_bind().dialect.name == "postgresql" else ":changes"
    json_metadata = "CAST(:metadata AS jsonb)" if db.get_bind().dialect.name == "postgresql" else ":metadata"
    db.execute(text(f"""
        INSERT INTO operation_logs
          (id, entity_type, entity_id, entity_number, action, summary, actor_user_id,
           actor_email, changes, metadata, created_at)
        VALUES (:id, 'channel', :bill,
                (SELECT statement_no FROM channel_records WHERE id = :bill),
                'contract_bindings_saved', :summary, :actor, :email,
                {json_changes}, {json_metadata}, CURRENT_TIMESTAMP)
    """), {
        "id": str(uuid4()), "bill": str(bill_id), "actor": actor or None,
        "email": (db.info.get("audit_actor") or {}).get("email") or None,
        "summary": "渠道账单合同依据随明细原子保存（含新增、迁移或解除）",
        "changes": json.dumps(changes, ensure_ascii=False),
        "metadata": json.dumps({"source": "channel_bill_save", "financial_values_rewritten": False}),
    })
