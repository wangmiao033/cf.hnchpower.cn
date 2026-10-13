"""Product-level R&D prepayment deduction ledger."""

from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from typing import Any
from uuid import uuid4

CENT = Decimal("0.01")
ZERO = Decimal("0")


def _decimal(value: Any) -> Decimal:
    try:
        parsed = Decimal(str(value or 0))
    except Exception:
        return ZERO
    if not parsed.is_finite():
        return ZERO
    return parsed


def _money(value: Any) -> Decimal:
    return _decimal(value).quantize(CENT, rounding=ROUND_HALF_UP)


def _relation_exists(row: Any, key: str = "relation_name") -> bool:
    """Return whether a ``to_regclass`` probe resolved a relation.

    Production contract connections use psycopg ``dict_row``. Older code read
    the probe with ``row[0]``, which raises ``KeyError: 0`` for mapping rows and
    breaks the whole R&D contract recommendation path. Keep this helper
    compatible with both mapping rows and positional rows so tests/future callers
    cannot reintroduce the same class of bug.
    """
    if row is None:
        return False
    if hasattr(row, "get"):
        return bool(row.get(key))
    try:
        return bool(row[0])
    except (KeyError, IndexError, TypeError):
        return False


def ensure_rd_prepayment_table(conn) -> None:
    """Require the versioned prepayment ledger schema without executing runtime DDL."""
    row = conn.execute(
        "SELECT to_regclass('public.cf_rd_prepayment_deductions') AS relation_name"
    ).fetchone()
    if not _relation_exists(row):
        raise RuntimeError(
            "RD_PREPAYMENT_SCHEMA_MISSING: production migration 060_rd_prepayment_deductions.sql is not applied"
        )


def enrich_prepayment_candidates(
    conn,
    candidates: list[dict],
    *,
    exclude_bill_id: str | None = None,
) -> list[dict]:
    """Attach used/available product prepayment to contract access candidates."""
    ensure_rd_prepayment_table(conn)
    access_ids = list(
        dict.fromkeys(
            str(item.get("access_item_id") or "").strip()
            for item in candidates
            if str(item.get("access_item_id") or "").strip()
        )
    )
    used_map: dict[str, Decimal] = {}
    funded_map: dict[str, Decimal] = {}
    funding_count_map: dict[str, int] = {}
    funding_table = conn.execute(
        "SELECT to_regclass('public.cf_rd_prepayment_fundings') AS relation_name"
    ).fetchone()
    if access_ids and _relation_exists(funding_table):
        placeholders = ",".join(["%s"] * len(access_ids))
        for row in conn.execute(
            f"""
            SELECT access_item_id, COALESCE(SUM(funded_amount), 0) AS funded_amount, COUNT(*) AS funding_count
            FROM cf_rd_prepayment_fundings
            WHERE access_item_id IN ({placeholders})
            GROUP BY access_item_id
            """,
            list(access_ids),
        ).fetchall():
            access_id = str(row["access_item_id"])
            funded_map[access_id] = _money(row.get("funded_amount"))
            funding_count_map[access_id] = int(row.get("funding_count") or 0)
    if access_ids:
        placeholders = ",".join(["%s"] * len(access_ids))
        sql = f"""
            SELECT access_item_id, COALESCE(SUM(deduction_amount), 0) AS used_amount
            FROM cf_rd_prepayment_deductions
            WHERE access_item_id IN ({placeholders})
        """
        params: list[Any] = list(access_ids)
        if exclude_bill_id:
            sql += " AND bill_id <> %s"
            params.append(exclude_bill_id)
        sql += " GROUP BY access_item_id"
        for row in conn.execute(sql, params).fetchall():
            used_map[str(row["access_item_id"])] = _money(row.get("used_amount"))

    out: list[dict] = []
    for source in candidates:
        item = dict(source)
        access_id = str(item.get("access_item_id") or "").strip()
        agreed = max(ZERO, _money(item.get("prepayment_amount")))
        used = max(ZERO, used_map.get(access_id, ZERO))
        actual_funded = max(ZERO, funded_map.get(access_id, ZERO))
        has_actual_funding = funding_count_map.get(access_id, 0) > 0
        effective_cap = min(agreed, actual_funded) if has_actual_funding else agreed
        available = max(ZERO, effective_cap - used)
        item["prepayment_used_amount"] = float(used)
        item["prepayment_actual_funded_amount"] = float(actual_funded)
        item["prepayment_funding_verified"] = has_actual_funding
        item["prepayment_funding_shortfall"] = float(max(ZERO, used - actual_funded) if has_actual_funding else ZERO)
        item["prepayment_available_amount"] = float(available)
        out.append(item)
    return out


def _line_rows(conn, bill_id: str) -> list[dict]:
    return list(
        conn.execute(
            """
            SELECT id, settlement_amount, sort_order
            FROM reconciliation_line_items
            WHERE reconciliation_id = %s
            ORDER BY sort_order, created_at, id
            """,
            [bill_id],
        ).fetchall()
    )


def _pool_available(agreed: Decimal, used: Decimal, funded: Decimal, funding_count: int) -> Decimal:
    if agreed <= ZERO:
        return ZERO
    cap = min(agreed, funded) if funding_count > 0 else agreed
    return max(ZERO, cap - used)


def _blank_plan(settlement: Decimal) -> dict[str, Any]:
    return {
        "enabled": False,
        "agreed": ZERO,
        "used": ZERO,
        "funded": ZERO,
        "funding_count": 0,
        "available_before": ZERO,
        "deduction": ZERO,
        "available_after": ZERO,
        "actual_payable": settlement,
    }


def plan_prepayment_deductions(lines: list[dict]) -> list[dict]:
    """Plan per-line deductions without touching the database.

    Contract mode consumes each access item's remaining pool in line order.
    Statement mode applies the bill-level balance from the partner statement.
    A statement balance is capped by a real contract pool when one exists, and
    can still be recorded when the contract has no prepayment amount.
    """
    statement_mode = any(line.get("statement_prepayment_deduction") is not None for line in lines or [])
    if statement_mode:
        requested = sum(
            (
                max(ZERO, _money(line.get("statement_prepayment_deduction")))
                for line in lines or []
            ),
            ZERO,
        )
        return _plan_statement_deductions(lines or [], requested)
    return _plan_contract_deductions(lines or [])


def _plan_contract_deductions(lines: list[dict]) -> list[dict]:
    extra_used: dict[str, Decimal] = {}
    planned: list[dict] = []
    for source in lines:
        settlement = max(ZERO, _money(source.get("settlement")))
        access_id = str(source.get("access_item_id") or "").strip()
        agreed = max(ZERO, _money(source.get("agreed")))
        if not access_id or agreed <= ZERO:
            planned.append(_blank_plan(settlement))
            continue
        used = max(ZERO, _money(source.get("used"))) + extra_used.get(access_id, ZERO)
        funded = max(ZERO, _money(source.get("funded")))
        funding_count = int(source.get("funding_count") or 0)
        available = _pool_available(agreed, used, funded, funding_count)
        deduction = min(settlement, available)
        extra_used[access_id] = extra_used.get(access_id, ZERO) + deduction
        planned.append(
            _filled_plan(
                settlement=settlement,
                agreed=agreed,
                used=used,
                funded=funded,
                funding_count=funding_count,
                available=available,
                deduction=deduction,
            )
        )
    return planned


def _plan_statement_deductions(lines: list[dict], requested: Decimal) -> list[dict]:
    has_pool = any(
        str(line.get("access_item_id") or "").strip() and max(ZERO, _money(line.get("agreed"))) > ZERO
        for line in lines
    )
    if has_pool:
        return _plan_statement_against_pools(lines, requested)
    remaining = requested
    planned: list[dict] = []
    for source in lines:
        settlement = max(ZERO, _money(source.get("settlement")))
        deduction = min(settlement, remaining)
        remaining = max(ZERO, remaining - deduction)
        if deduction <= ZERO:
            planned.append(_blank_plan(settlement))
            continue
        planned.append(
            _filled_plan(
                settlement=settlement,
                agreed=ZERO,
                used=ZERO,
                funded=ZERO,
                funding_count=0,
                available=deduction,
                deduction=deduction,
            )
        )
    return planned


def _plan_statement_against_pools(lines: list[dict], requested: Decimal) -> list[dict]:
    extra_used: dict[str, Decimal] = {}
    remaining = requested
    planned: list[dict] = []
    for source in lines:
        settlement = max(ZERO, _money(source.get("settlement")))
        access_id = str(source.get("access_item_id") or "").strip()
        agreed = max(ZERO, _money(source.get("agreed")))
        if not access_id or agreed <= ZERO or remaining <= ZERO:
            planned.append(_blank_plan(settlement))
            continue
        used = max(ZERO, _money(source.get("used"))) + extra_used.get(access_id, ZERO)
        funded = max(ZERO, _money(source.get("funded")))
        funding_count = int(source.get("funding_count") or 0)
        available = _pool_available(agreed, used, funded, funding_count)
        deduction = min(settlement, available, remaining)
        remaining = max(ZERO, remaining - deduction)
        extra_used[access_id] = extra_used.get(access_id, ZERO) + deduction
        planned.append(
            _filled_plan(
                settlement=settlement,
                agreed=agreed,
                used=used,
                funded=funded,
                funding_count=funding_count,
                available=available,
                deduction=deduction,
            )
        )
    return planned


def _filled_plan(
    *,
    settlement: Decimal,
    agreed: Decimal,
    used: Decimal,
    funded: Decimal,
    funding_count: int,
    available: Decimal,
    deduction: Decimal,
) -> dict[str, Any]:
    applied = min(settlement, max(ZERO, deduction))
    return {
        "enabled": True,
        "agreed": agreed,
        "used": used,
        "funded": funded,
        "funding_count": funding_count,
        "available_before": available,
        "deduction": applied,
        "available_after": max(ZERO, available - applied),
        "actual_payable": max(ZERO, settlement - applied),
    }


def _pool_snapshot(conn, access_item_id: str, cache: dict[str, dict]) -> dict:
    if access_item_id in cache:
        return cache[access_item_id]
    if not access_item_id:
        snapshot = {
            "agreed": ZERO,
            "used": ZERO,
            "funded": ZERO,
            "funding_count": 0,
            "contract_id": "",
        }
        cache[access_item_id] = snapshot
        return snapshot

    term = conn.execute(
        """
        SELECT terms.prepayment_amount, access.contract_id
        FROM cf_contract_access_terms AS terms
        JOIN cf_contract_access_items AS access ON access.id = terms.access_item_id
        WHERE terms.access_item_id = %s
        FOR UPDATE OF terms
        """,
        [access_item_id],
    ).fetchone()
    agreed = max(ZERO, _money(term.get("prepayment_amount") if term else 0))
    used_row = conn.execute(
        """
        SELECT COALESCE(SUM(deduction_amount), 0) AS used_amount
        FROM cf_rd_prepayment_deductions
        WHERE access_item_id = %s
        """,
        [access_item_id],
    ).fetchone()
    used = max(ZERO, _money(used_row.get("used_amount") if used_row else 0))
    funded = ZERO
    funding_count = 0
    funding_table = conn.execute(
        "SELECT to_regclass('public.cf_rd_prepayment_fundings') AS relation_name"
    ).fetchone()
    if _relation_exists(funding_table):
        funding_row = conn.execute(
            """
            SELECT COALESCE(SUM(funded_amount), 0) AS funded_amount, COUNT(*) AS funding_count
            FROM cf_rd_prepayment_fundings
            WHERE access_item_id = %s
            """,
            [access_item_id],
        ).fetchone()
        funded = max(ZERO, _money(funding_row.get("funded_amount") if funding_row else 0))
        funding_count = int(funding_row.get("funding_count") or 0) if funding_row else 0
    snapshot = {
        "agreed": agreed,
        "used": used,
        "funded": funded,
        "funding_count": funding_count,
        "contract_id": str(term.get("contract_id") or "") if term else "",
    }
    cache[access_item_id] = snapshot
    return snapshot


def replace_bill_prepayment_deductions(
    conn,
    bill_id: str,
    metadata: list[dict],
    actor: str,
) -> list[dict]:
    """Atomically rebuild deductions for one bill and return audited metadata."""
    ensure_rd_prepayment_table(conn)
    conn.execute("DELETE FROM cf_rd_prepayment_deductions WHERE bill_id = %s", [bill_id])
    lines = _line_rows(conn, bill_id)
    prepared: list[dict] = []
    contexts: list[dict] = []
    pool_cache: dict[str, dict] = {}

    for position, source in enumerate(metadata or []):
        item = dict(source or {})
        try:
            line_index = int(item.get("line_index", position))
        except (TypeError, ValueError):
            line_index = position
        line = lines[line_index] if 0 <= line_index < len(lines) else None
        settlement = max(ZERO, _money(line.get("settlement_amount") if line else 0))
        access_item_id = str(item.get("access_item_id") or "").strip()
        pool = _pool_snapshot(conn, access_item_id, pool_cache) if line else {
            "agreed": ZERO,
            "used": ZERO,
            "funded": ZERO,
            "funding_count": 0,
            "contract_id": "",
        }
        statement_amount = item.get("statement_prepayment_deduction", None)
        if isinstance(statement_amount, str) and not statement_amount.strip():
            statement_amount = None
        prepared.append(
            {
                "item": item,
                "line": line,
                "line_index": line_index,
                "access_item_id": access_item_id,
                "contract_id": pool["contract_id"] or str(item.get("contract_id") or ""),
            }
        )
        contexts.append(
            {
                "settlement": settlement,
                "access_item_id": access_item_id if line else "",
                "agreed": pool["agreed"] if line else ZERO,
                "used": pool["used"] if line else ZERO,
                "funded": pool["funded"] if line else ZERO,
                "funding_count": pool["funding_count"] if line else 0,
                "statement_prepayment_deduction": None if statement_amount is None else statement_amount,
            }
        )

    planned = plan_prepayment_deductions(contexts)
    updated: list[dict] = []
    for row, plan in zip(prepared, planned):
        item = row["item"]
        line = row["line"]
        deduction = plan["deduction"]
        item.update(
            {
                "prepayment_enabled": bool(plan["enabled"]),
                "prepayment_agreed_amount": float(plan["agreed"]),
                "prepayment_used_amount": float(plan["used"]),
                "prepayment_actual_funded_amount": float(plan["funded"]),
                "prepayment_funding_verified": int(plan["funding_count"]) > 0,
                "prepayment_funding_shortfall": float(
                    max(ZERO, plan["used"] - plan["funded"]) if int(plan["funding_count"]) > 0 else ZERO
                ),
                "prepayment_available_before": float(plan["available_before"]),
                "prepayment_deduction": float(deduction),
                "prepayment_available_after": float(plan["available_after"]),
                "actual_payable": float(plan["actual_payable"]),
            }
        )
        if line and deduction > ZERO:
            conn.execute(
                """
                INSERT INTO cf_rd_prepayment_deductions (
                  id, bill_id, line_index, line_id, access_item_id, contract_id,
                  settlement_amount, deduction_amount, created_by, created_at, updated_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW())
                """,
                [
                    uuid4().hex,
                    bill_id,
                    row["line_index"],
                    str(line.get("id") or ""),
                    row["access_item_id"],
                    row["contract_id"],
                    max(ZERO, _money(line.get("settlement_amount"))),
                    deduction,
                    actor,
                ],
            )
        updated.append(item)

    return updated
