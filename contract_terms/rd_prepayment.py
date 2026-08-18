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

    Production contract connections use psycopg ``dict_row``.  Older code read
    the probe with ``row[0]``, which raises ``KeyError: 0`` for mapping rows and
    breaks the whole R&D contract recommendation path.  Keep this helper
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
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS cf_rd_prepayment_deductions (
          id TEXT PRIMARY KEY,
          bill_id TEXT NOT NULL,
          line_index INTEGER NOT NULL DEFAULT 0,
          line_id TEXT NOT NULL DEFAULT '',
          access_item_id TEXT NOT NULL,
          contract_id TEXT NOT NULL DEFAULT '',
          settlement_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
          deduction_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
          created_by TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (bill_id, line_index)
        )
        """
    )
    conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_cf_rd_prepayment_deductions_access
        ON cf_rd_prepayment_deductions (access_item_id, created_at)
        """
    )
    conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_cf_rd_prepayment_deductions_bill
        ON cf_rd_prepayment_deductions (bill_id)
        """
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
    updated: list[dict] = []

    for position, source in enumerate(metadata or []):
        item = dict(source or {})
        try:
            line_index = int(item.get("line_index", position))
        except (TypeError, ValueError):
            line_index = position
        line = lines[line_index] if 0 <= line_index < len(lines) else None
        settlement = max(ZERO, _money(line.get("settlement_amount") if line else 0))
        access_item_id = str(item.get("access_item_id") or "").strip()

        item.update(
            {
                "prepayment_enabled": False,
                "prepayment_agreed_amount": 0.0,
                "prepayment_used_amount": 0.0,
                "prepayment_actual_funded_amount": 0.0,
                "prepayment_funding_verified": False,
                "prepayment_funding_shortfall": 0.0,
                "prepayment_available_before": 0.0,
                "prepayment_deduction": 0.0,
                "prepayment_available_after": 0.0,
                "actual_payable": float(settlement),
            }
        )
        if not line or not access_item_id:
            updated.append(item)
            continue

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
        if term is None or agreed <= ZERO:
            updated.append(item)
            continue

        used_row = conn.execute(
            """
            SELECT COALESCE(SUM(deduction_amount), 0) AS used_amount
            FROM cf_rd_prepayment_deductions
            WHERE access_item_id = %s
            """,
            [access_item_id],
        ).fetchone()
        used = max(ZERO, _money(used_row.get("used_amount") if used_row else 0))
        funding_table = conn.execute(
            "SELECT to_regclass('public.cf_rd_prepayment_fundings') AS relation_name"
        ).fetchone()
        funded = ZERO
        funding_count = 0
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
        effective_cap = min(agreed, funded) if funding_count > 0 else agreed
        available = max(ZERO, effective_cap - used)
        deduction = min(settlement, available)
        after = max(ZERO, available - deduction)
        actual = max(ZERO, settlement - deduction)

        if deduction > ZERO:
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
                    line_index,
                    str(line.get("id") or ""),
                    access_item_id,
                    str(term.get("contract_id") or item.get("contract_id") or ""),
                    settlement,
                    deduction,
                    actor,
                ],
            )

        item.update(
            {
                "prepayment_enabled": True,
                "prepayment_agreed_amount": float(agreed),
                "prepayment_used_amount": float(used),
                "prepayment_actual_funded_amount": float(funded),
                "prepayment_funding_verified": funding_count > 0,
                "prepayment_funding_shortfall": float(max(ZERO, used - funded) if funding_count > 0 else ZERO),
                "prepayment_available_before": float(available),
                "prepayment_deduction": float(deduction),
                "prepayment_available_after": float(after),
                "actual_payable": float(actual),
            }
        )
        updated.append(item)

    return updated
