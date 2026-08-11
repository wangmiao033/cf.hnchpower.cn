"""银行对方户名 -> 客户中心映射与简称解析。"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
import re
from typing import Any

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.models.bank_transaction import BankTransaction
from app.services.bank_auto_reconciliation import transaction_direction

_COMPANY_SUFFIXES = (
    "有限责任公司",
    "股份有限公司",
    "有限公司",
    "责任公司",
    "公司",
    "pte.ltd",
    "pte ltd",
    "limited",
    "ltd",
    "inc",
)


def normalize_party(value: object) -> str:
    raw = str(value or "").strip().lower()
    raw = raw.replace("（", "(").replace("）", ")")
    return re.sub(r"[\s\-—_·,，.。()（）\[\]【】/\\]", "", raw)


def normalize_company(value: object) -> str:
    raw = normalize_party(value)
    for suffix in _COMPANY_SUFFIXES:
        suffix_key = normalize_party(suffix)
        if raw.endswith(suffix_key) and len(raw) > len(suffix_key) + 1:
            return raw[: -len(suffix_key)]
    return raw


def normalize_account(value: object) -> str:
    return re.sub(r"[^0-9a-zA-Z*]", "", str(value or "")).lower()


def _counterparty(row: BankTransaction, direction: str) -> tuple[str, str]:
    if direction == "collection":
        return str(row.payer_name or row.payee_name or "").strip(), str(row.payer_account or "").strip()
    if direction == "payment":
        return str(row.payee_name or row.payer_name or "").strip(), str(row.payee_account or "").strip()
    return str(row.payee_name or row.payer_name or "").strip(), str(row.payee_account or row.payer_account or "").strip()


@dataclass(frozen=True)
class PartnerResolution:
    partner_id: str
    partner_name: str
    short_name: str
    match_method: str
    explicit: bool = False

    def payload(self) -> dict[str, Any]:
        return {
            "partner_id": self.partner_id,
            "partner_name": self.partner_name,
            "partner_short_name": self.short_name,
            "partner_match_method": self.match_method,
            "partner_match_explicit": self.explicit,
        }


class BankPartnerResolver:
    def __init__(self, db: Session):
        self.db = db
        self.partners = self._load_partners()
        self.links = self._load_links()
        self.by_name: dict[str, dict] = {}
        self.by_company: dict[str, list[dict]] = defaultdict(list)
        self.by_account: dict[str, list[dict]] = defaultdict(list)
        for partner in self.partners:
            name_key = normalize_party(partner.get("name"))
            if name_key:
                self.by_name[name_key] = partner
            company_key = normalize_company(partner.get("name"))
            if company_key:
                self.by_company[company_key].append(partner)
            account_key = normalize_account(partner.get("bank_account"))
            if account_key:
                self.by_account[account_key].append(partner)

    def _load_partners(self) -> list[dict]:
        rows = self.db.execute(
            text(
                """
                SELECT id, name, short_name, category, tag, bank_name, bank_account
                FROM cf_partner_records
                ORDER BY category, name
                """
            )
        ).mappings().all()
        return [dict(row) for row in rows]

    def _load_links(self) -> dict[str, dict]:
        rows = self.db.execute(
            text(
                """
                SELECT
                  link.normalized_counterparty_name,
                  link.counterparty_name_snapshot,
                  link.partner_id,
                  link.match_method,
                  partner.name AS partner_name,
                  partner.short_name AS partner_short_name
                FROM bank_counterparty_partner_links AS link
                LEFT JOIN cf_partner_records AS partner ON partner.id = link.partner_id
                """
            )
        ).mappings().all()
        return {str(row["normalized_counterparty_name"]): dict(row) for row in rows}

    def resolve(self, counterparty_name: object, counterparty_account: object = None) -> PartnerResolution | None:
        name = str(counterparty_name or "").strip()
        name_key = normalize_party(name)
        if not name_key:
            return None

        explicit = self.links.get(name_key)
        if explicit and explicit.get("partner_name"):
            return PartnerResolution(
                partner_id=str(explicit["partner_id"]),
                partner_name=str(explicit.get("partner_name") or ""),
                short_name=str(explicit.get("partner_short_name") or ""),
                match_method="manual",
                explicit=True,
            )

        direct = self.by_name.get(name_key)
        if direct:
            return self._resolution(direct, "exact_name")

        account_key = normalize_account(counterparty_account)
        if account_key:
            account_matches = self.by_account.get(account_key, [])
            if len(account_matches) == 1:
                return self._resolution(account_matches[0], "bank_account")

        company_key = normalize_company(name)
        company_matches = self.by_company.get(company_key, []) if company_key else []
        if len(company_matches) == 1:
            return self._resolution(company_matches[0], "normalized_name")
        return None

    def suggest(self, counterparty_name: object, counterparty_account: object = None) -> dict | None:
        resolved = self.resolve(counterparty_name, counterparty_account)
        if resolved:
            return {**resolved.payload(), "score": 100 if resolved.explicit or resolved.match_method in {"exact_name", "bank_account"} else 92}

        raw_key = normalize_company(counterparty_name)
        if not raw_key:
            return None
        candidates: list[tuple[int, dict]] = []
        for partner in self.partners:
            short_key = normalize_party(partner.get("short_name"))
            name_key = normalize_company(partner.get("name"))
            score = 0
            if short_key and len(short_key) >= 2 and (short_key in raw_key or raw_key in short_key):
                score = max(score, 78)
            if name_key and len(name_key) >= 3 and (name_key in raw_key or raw_key in name_key):
                score = max(score, 72)
            if score:
                candidates.append((score, partner))
        candidates.sort(key=lambda item: item[0], reverse=True)
        if not candidates:
            return None
        top_score, top = candidates[0]
        if len(candidates) > 1 and candidates[1][0] >= top_score:
            return None
        return {
            "partner_id": str(top["id"]),
            "partner_name": str(top.get("name") or ""),
            "partner_short_name": str(top.get("short_name") or ""),
            "partner_match_method": "suggested_alias",
            "partner_match_explicit": False,
            "score": top_score,
        }

    @staticmethod
    def _resolution(partner: dict, method: str) -> PartnerResolution:
        return PartnerResolution(
            partner_id=str(partner["id"]),
            partner_name=str(partner.get("name") or ""),
            short_name=str(partner.get("short_name") or ""),
            match_method=method,
            explicit=False,
        )


def _candidate_matches_partner(candidate: dict, resolution: PartnerResolution) -> bool:
    candidate_name = str(candidate.get("partner_name") or "")
    candidate_keys = {normalize_party(candidate_name), normalize_company(candidate_name)} - {""}
    partner_keys = {
        normalize_party(resolution.partner_name),
        normalize_company(resolution.partner_name),
        normalize_party(resolution.short_name),
    } - {""}
    return bool(candidate_keys & partner_keys)


def enrich_reconciliation_dashboard(db: Session, result: dict) -> dict:
    """把客户简称/人工客户映射注入银行建议，并让人工客户映射参与候选排序。"""
    suggestions = list(result.get("suggestions") or [])
    if not suggestions:
        return result
    resolver = BankPartnerResolver(db)
    tx_ids = [str(item.get("transaction_id") or "") for item in suggestions if item.get("transaction_id")]
    tx_map = {
        str(row.id): row
        for row in db.execute(select(BankTransaction).where(BankTransaction.id.in_(tx_ids))).scalars().all()
    } if tx_ids else {}

    for item in suggestions:
        tx = tx_map.get(str(item.get("transaction_id") or ""))
        direction = str(item.get("direction") or "unknown")
        raw_name = str(item.get("counterparty_name") or "").strip()
        raw_account = ""
        if tx is not None:
            raw_name, raw_account = _counterparty(tx, direction)
        item["counterparty_raw_name"] = raw_name or None
        resolution = resolver.resolve(raw_name, raw_account)
        if not resolution:
            item.update(
                {
                    "partner_id": None,
                    "partner_name": None,
                    "partner_short_name": None,
                    "partner_match_method": None,
                    "partner_match_explicit": False,
                }
            )
            continue

        item.update(resolution.payload())
        label = resolution.short_name or resolution.partner_name
        item["counterparty_name"] = f"{label} · {raw_name}" if raw_name and normalize_party(label) != normalize_party(raw_name) else (label or raw_name)

        # 只有人工固定映射/银行账号唯一命中才额外改变推荐顺序；名称本来一致时原引擎已计分。
        if resolution.explicit or resolution.match_method == "bank_account":
            candidates = list(item.get("candidates") or [])
            changed = False
            for candidate in candidates:
                if not _candidate_matches_partner(candidate, resolution):
                    continue
                candidate["score"] = min(100.0, round(float(candidate.get("score") or 0) + 30.0, 2))
                reasons = list(candidate.get("reasons") or [])
                reason = f"客户匹配中心已确认：{label}"
                if reason not in reasons:
                    reasons.append(reason)
                candidate["reasons"] = reasons
                candidate["confidence_level"] = "high" if candidate["score"] >= 80 else "medium" if candidate["score"] >= 60 else "low"
                changed = True
            if changed and candidates:
                amount = float(item.get("amount") or 0)
                candidates.sort(key=lambda row: (float(row.get("score") or 0), -abs(float(row.get("outstanding_amount") or 0) - amount)), reverse=True)
                top = candidates[0]
                second = candidates[1] if len(candidates) > 1 else None
                margin = float(top.get("score") or 0) - float(second.get("score") or 0 if second else 0)
                level = "high" if float(top.get("score") or 0) >= 80 and margin >= 10 else "medium" if float(top.get("score") or 0) >= 60 else "low"
                item["candidates"] = candidates
                item["top_score"] = float(top.get("score") or 0)
                item["ambiguity_margin"] = round(margin, 2)
                item["confidence_level"] = level
                item["auto_ready"] = level == "high"
                if level != "low":
                    item["blocked_reason"] = None

    stats = result.setdefault("stats", {})
    stats["high_confidence"] = sum(1 for item in suggestions if item.get("confidence_level") == "high")
    stats["medium_confidence"] = sum(1 for item in suggestions if item.get("confidence_level") == "medium")
    stats["unmatched"] = sum(1 for item in suggestions if item.get("confidence_level") in {"low", "none"})
    result["suggestions"] = suggestions
    return result


def customer_match_center(db: Session) -> dict:
    resolver = BankPartnerResolver(db)
    rows = db.execute(
        select(BankTransaction)
        .where(BankTransaction.type == "statement_import")
        .order_by(BankTransaction.trade_date.desc().nullslast(), BankTransaction.created_at.desc())
    ).scalars().all()

    grouped: dict[str, dict] = {}
    for row in rows:
        direction, amount, _blocked = transaction_direction(row)
        raw_name, raw_account = _counterparty(row, direction)
        key = normalize_party(raw_name)
        if not key:
            continue
        bucket = grouped.setdefault(
            key,
            {
                "counterparty_key": key,
                "counterparty_name": raw_name,
                "accounts": set(),
                "directions": set(),
                "transaction_count": 0,
                "income_total": 0.0,
                "expense_total": 0.0,
                "last_trade_date": row.trade_date,
            },
        )
        if raw_account:
            bucket["accounts"].add(raw_account)
        bucket["directions"].add(direction)
        bucket["transaction_count"] += 1
        if direction == "collection":
            bucket["income_total"] += float(amount or 0)
        elif direction == "payment":
            bucket["expense_total"] += float(amount or 0)
        if row.trade_date and (not bucket["last_trade_date"] or row.trade_date > bucket["last_trade_date"]):
            bucket["last_trade_date"] = row.trade_date

    items: list[dict] = []
    for bucket in grouped.values():
        accounts = sorted(bucket.pop("accounts"))
        directions = sorted(bucket.pop("directions"))
        account = accounts[0] if len(accounts) == 1 else ""
        resolution = resolver.resolve(bucket["counterparty_name"], account)
        suggestion = resolver.suggest(bucket["counterparty_name"], account) if not resolution else None
        item = {
            **bucket,
            "accounts": accounts,
            "directions": directions,
            "income_total": round(float(bucket["income_total"]), 2),
            "expense_total": round(float(bucket["expense_total"]), 2),
            "total_amount": round(float(bucket["income_total"]) + float(bucket["expense_total"]), 2),
            "matched": bool(resolution),
            "explicit": bool(resolution.explicit) if resolution else False,
            "partner_id": resolution.partner_id if resolution else None,
            "partner_name": resolution.partner_name if resolution else None,
            "partner_short_name": resolution.short_name if resolution else None,
            "match_method": resolution.match_method if resolution else None,
            "suggested_partner": suggestion,
        }
        items.append(item)

    items.sort(key=lambda row: (1 if row["matched"] else 0, str(row.get("last_trade_date") or "")), reverse=False)
    # 未匹配优先；每组内部最近交易优先。
    items.sort(key=lambda row: (1 if row["matched"] else 0, -int(str(row.get("last_trade_date") or "0").replace("-", "") or 0)))
    return {
        "stats": {
            "counterparties": len(items),
            "matched": sum(1 for item in items if item["matched"]),
            "manual": sum(1 for item in items if item["explicit"]),
            "unmatched": sum(1 for item in items if not item["matched"]),
        },
        "items": items,
    }


def save_customer_link(db: Session, *, counterparty_name: str, partner_id: str, user: Any) -> dict:
    key = normalize_party(counterparty_name)
    if not key:
        raise ValueError("请填写银行对方户名")
    partner = db.execute(
        text("SELECT id, name, short_name FROM cf_partner_records WHERE id = :partner_id"),
        {"partner_id": partner_id},
    ).mappings().first()
    if not partner:
        raise LookupError("客户不存在或已删除")
    db.execute(
        text(
            """
            INSERT INTO bank_counterparty_partner_links (
              normalized_counterparty_name,
              counterparty_name_snapshot,
              partner_id,
              match_method,
              created_by,
              created_email
            ) VALUES (
              :key, :snapshot, :partner_id, 'manual', :created_by, :created_email
            )
            ON CONFLICT (normalized_counterparty_name) DO UPDATE SET
              counterparty_name_snapshot = EXCLUDED.counterparty_name_snapshot,
              partner_id = EXCLUDED.partner_id,
              match_method = 'manual',
              updated_at = NOW()
            """
        ),
        {
            "key": key,
            "snapshot": str(counterparty_name).strip(),
            "partner_id": str(partner["id"]),
            "created_by": str(getattr(user, "id", "") or ""),
            "created_email": str(getattr(user, "email", "") or ""),
        },
    )
    db.commit()
    return {
        "counterparty_name": str(counterparty_name).strip(),
        "partner_id": str(partner["id"]),
        "partner_name": str(partner.get("name") or ""),
        "partner_short_name": str(partner.get("short_name") or ""),
        "match_method": "manual",
    }


def remove_customer_link(db: Session, *, counterparty_name: str) -> bool:
    key = normalize_party(counterparty_name)
    if not key:
        return False
    result = db.execute(
        text("DELETE FROM bank_counterparty_partner_links WHERE normalized_counterparty_name = :key"),
        {"key": key},
    )
    db.commit()
    return bool(result.rowcount)
