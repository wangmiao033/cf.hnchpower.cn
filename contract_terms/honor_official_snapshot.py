"""Source revisions for the opt-in Honor official-statement review only."""
from datetime import datetime, timezone

from fastapi import HTTPException


def _utc(value):
    if isinstance(value, str):
        value = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def attach_honor_source_revisions(conn, bill_id, result):
    """Record presence AND revision; removed terms/bindings must invalidate review.

    Lock matched existing rows. If they changed after calculation began, fail
    closed rather than attaching newer revisions to older computed evidence.
    """
    generated = _utc(result["generated_at"])
    ids = [str((row.get("match") or {}).get("access_item_id") or "") for row in result.get("lines") or []]
    rows = conn.execute("""
        SELECT a.id AS access_item_id, c.updated_at AS contract_updated_at,
               a.updated_at AS access_updated_at
        FROM cf_contract_access_items a JOIN cf_contract_records c ON c.id = a.contract_id
        WHERE a.id = ANY(%s) FOR SHARE OF a, c
    """, [ids]).fetchall()
    terms = conn.execute("""
        SELECT access_item_id, updated_at FROM cf_contract_access_terms
        WHERE access_item_id = ANY(%s) FOR SHARE
    """, [ids]).fetchall()
    term_map = {str(row["access_item_id"]): row["updated_at"] for row in terms}
    revisions = {}
    for row in rows:
        revision = dict(row, terms_updated_at=term_map.get(str(row["access_item_id"])))
        if any(revision[key] is not None and _utc(revision[key]) > generated
               for key in ("contract_updated_at", "access_updated_at", "terms_updated_at")):
            raise HTTPException(409, detail="合同来源刚刚发生变化，请重新核验荣耀官方结算单")
        revisions[str(row["access_item_id"])] = revision
    links = conn.execute("""
        SELECT line_id, access_item_id, updated_at FROM cf_bill_contract_links
        WHERE bill_type = 'channel' AND bill_id = %s FOR SHARE
    """, [bill_id]).fetchall()
    if any(_utc(row["updated_at"]) > generated for row in links):
        raise HTTPException(409, detail="合同绑定刚刚发生变化，请重新核验荣耀官方结算单")
    return dict(result, honor_source_revisions=revisions,
                honor_binding_revisions={str(row["line_id"]): dict(row) for row in links})
