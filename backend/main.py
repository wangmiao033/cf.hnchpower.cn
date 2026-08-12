from app.main import app

# Temporary one-off import endpoint for the 2026-08-12 tax-invoice batch.
# The payload is encrypted in repository files; the decryption key is never stored in Git.
import base64
import hashlib
import hmac
import json
import zlib
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from fastapi import Depends, HTTPException, Query
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.deps import get_db
from app.models.invoice import InvoiceRecord

_NONCE = "ZwW6Qfthb7IuI9QX3mTboQ=="
_TAG = "/5/JkztaYoAxl7Q5uXAZXzGrK1xv3H0WeBWD/jRFggI="
_EXPECTED_SHA256 = "3c85a8264e0c526dcff3f4081fe8ea135d987de492f87905105c05b9d972169e"
_EXPECTED_TOTAL = 279


def _decode_key(value: str) -> bytes:
    value = value.strip()
    return base64.urlsafe_b64decode(value + "=" * ((4 - len(value) % 4) % 4))


def _load_items(key_text: str) -> list[dict]:
    try:
        key = _decode_key(key_text)
        if len(key) != 32:
            raise ValueError("invalid key")
        root = Path(__file__).resolve().parent
        encrypted_text = "".join(
            (root / f".oneoff_invoice_payload_{index}").read_text(encoding="utf-8").strip()
            for index in range(7)
        )
        cipher = base64.b64decode(encrypted_text)
        nonce = base64.b64decode(_NONCE)
        expected_tag = base64.b64decode(_TAG)
        actual_tag = hmac.new(key, nonce + cipher, hashlib.sha256).digest()
        if not hmac.compare_digest(actual_tag, expected_tag):
            raise ValueError("invalid tag")
        stream = bytearray()
        counter = 0
        while len(stream) < len(cipher):
            stream.extend(hmac.new(key, nonce + counter.to_bytes(8, "big"), hashlib.sha256).digest())
            counter += 1
        compressed = bytes(a ^ b for a, b in zip(cipher, stream))
        plain = zlib.decompress(compressed)
        if hashlib.sha256(plain).hexdigest() != _EXPECTED_SHA256:
            raise ValueError("invalid checksum")
        items = json.loads(plain.decode("utf-8"))
        if not isinstance(items, list) or len(items) != _EXPECTED_TOTAL:
            raise ValueError("invalid count")
        return items
    except Exception as exc:
        raise HTTPException(status_code=404, detail="not found") from exc


@app.get("/api/_ops/invoice-import-JzBkkx-GhbDioQzMpFdUu3hB")
def oneoff_invoice_import_20260812(
    k: str = Query(..., min_length=20, max_length=200),
    db: Session = Depends(get_db),
):
    items = _load_items(k)
    identities = [str(item["invoice_identity_key"]) for item in items]
    digital_numbers = [str(item["digital_invoice_no"]) for item in items]

    existing_rows = (
        db.execute(
            select(InvoiceRecord).where(
                or_(
                    InvoiceRecord.invoice_identity_key.in_(identities),
                    InvoiceRecord.digital_invoice_no.in_(digital_numbers),
                )
            )
        )
        .scalars()
        .all()
    )
    existing_by_identity: dict[str, InvoiceRecord] = {}
    for row in existing_rows:
        if row.invoice_identity_key:
            existing_by_identity[str(row.invoice_identity_key)] = row
        if row.digital_invoice_no:
            existing_by_identity.setdefault(f"digital:{row.digital_invoice_no}", row)

    created = 0
    updated = 0
    original_links: list[tuple[InvoiceRecord, str]] = []
    now = datetime.now(timezone.utc)

    for item in items:
        data = dict(item)
        original_digital = data.pop("original_invoice_digital_no", None)
        identity = str(data["invoice_identity_key"])
        row = existing_by_identity.get(identity)
        if row is None:
            row = InvoiceRecord(
                id=str(uuid4()),
                **data,
                verified=False,
                verified_amount=0,
                verified_record_ids=[],
            )
            db.add(row)
            existing_by_identity[identity] = row
            created += 1
        else:
            # Preserve existing verification/allocation facts on re-import.
            for field, value in data.items():
                setattr(row, field, value)
            row.updated_at = now
            updated += 1
        if original_digital:
            original_links.append((row, str(original_digital)))

    db.flush()
    by_digital = {
        str(row.digital_invoice_no): row
        for row in existing_by_identity.values()
        if row.digital_invoice_no
    }
    linked_originals = 0
    missing_originals: list[str] = []
    for row, original_digital in original_links:
        original = by_digital.get(original_digital)
        if original is None:
            original = db.execute(
                select(InvoiceRecord)
                .where(InvoiceRecord.digital_invoice_no == original_digital)
                .limit(1)
            ).scalar_one_or_none()
        if original is None:
            missing_originals.append(original_digital)
        else:
            row.original_invoice_id = original.id
            linked_originals += 1

    db.commit()

    present_rows = (
        db.execute(
            select(InvoiceRecord.invoice_identity_key).where(
                InvoiceRecord.invoice_identity_key.in_(identities)
            )
        )
        .scalars()
        .all()
    )
    present = {str(value) for value in present_rows if value}
    missing = [identity for identity in identities if identity not in present]

    return {
        "ok": not missing,
        "expected": len(items),
        "created": created,
        "updated": updated,
        "present": len(present),
        "missing": missing[:20],
        "output": sum(1 for item in items if item.get("invoice_direction") == "output"),
        "input": sum(1 for item in items if item.get("invoice_direction") == "input"),
        "red": sum(1 for item in items if item.get("tax_status") == "red"),
        "buyer_name_warnings": sum(
            1
            for item in items
            if item.get("invoice_direction") == "input"
            and item.get("buyer_tax_no") == "91440104MABURP0XXA"
            and item.get("buyer_name") != "广州熊动科技有限公司"
        ),
        "linked_originals": linked_originals,
        "missing_originals": sorted(set(missing_originals)),
    }
