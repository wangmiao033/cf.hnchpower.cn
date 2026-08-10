"""Parse text-bearing electronic VAT invoice files (PDF/OFD/XML).

The parser intentionally does not OCR image-only invoices. Chinese electronic VAT invoices
normally carry either a PDF text layer or structured XML/OFD content, which is more reliable
than OCR for accounting fields.
"""

from __future__ import annotations

from io import BytesIO
from pathlib import Path
import re
from typing import Any
import xml.etree.ElementTree as ET
import zipfile

from pypdf import PdfReader

SUPPORTED_ELECTRONIC_INVOICE_TYPES = {
    ".pdf": "application/pdf",
    ".ofd": "application/ofd",
    ".xml": "application/xml",
}

_MONEY = r"([0-9][0-9,]*\(?:\.\d{1,2}\)?)"


def normalize_date(value: str | None) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    match = re.search(r"(20\d{2})\D{0,3}(\d{1,2})\D{0,3}(\d{1,2})", text)
    if not match:
        return ""
    return f"{match.group(1)}-{int(match.group(2)):02d}-{int(match.group(3)):02d}"


def _money(value: str | None) -> float | None:
    if value is None:
        return None
    cleaned = re.sub(r"[^0-9.\-]", "", str(value))
    if not cleaned:
        return None
    try:
        return round(float(cleaned), 2)
    except ValueError:
        return None


def _clean_text(value: str | None) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _first(patterns: list[str], text: str, flags: int = 0) -> str:
    for pattern in patterns:
        match = re.search(pattern, text, flags)
        if match:
            return _clean_text(match.group(1))
    return ""


def _xml_text(body: bytes) -> str:
    try:
        root = ET.fromstring(body)
    except ET.ParseError:
        return body.decode("utf-8", errors="ignore")
    values = [str(value).strip() for value in root.itertext() if str(value).strip()]
    # Also surface tag names alongside values. Many e-invoice XML formats encode semantic
    # meaning in element names rather than visible label text.
    tagged: list[str] = []
    for node in root.iter():
        if node.text and node.text.strip():
            tag = node.tag.rsplit("}", 1)[-1]
            tagged.append(f"{tag}:{node.text.strip()}")
    return "\n".join(values + tagged)


def _ofd_text(body: bytes) -> str:
    texts: list[str] = []
    with zipfile.ZipFile(BytesIO(body)) as archive:
        xml_names = sorted(name for name in archive.namelist() if name.lower().endswith(".xml"))
        for name in xml_names[:200]:
            try:
                texts.append(_xml_text(archive.read(name)))
            except Exception:
                continue
    return "\n".join(texts)


def _pdf_text(body: bytes) -> str:
    reader = PdfReader(BytesIO(body))
    parts: list[str] = []
    for page in reader.pages[:10]:
        value = page.extract_text() or ""
        if value.strip():
            parts.append(value)
    return "\n".join(parts)


def extract_electronic_invoice_text(file_name: str, body: bytes) -> tuple[str, str, str]:
    suffix = Path(file_name or "invoice").suffix.lower()
    content_type = SUPPORTED_ELECTRONIC_INVOICE_TYPES.get(suffix)
    if not content_type:
        raise ValueError("unsupported_file_type")
    if suffix == ".pdf":
        text = _pdf_text(body)
        parser = "pdf_text"
    elif suffix == ".ofd":
        text = _ofd_text(body)
        parser = "ofd_xml"
    else:
        text = _xml_text(body)
        parser = "xml"
    return text, parser, content_type


def _party_section(text: str, start_label: str, end_label: str | None) -> str:
    start = re.search(start_label, text, re.I)
    if not start:
        return ""
    tail = text[start.end():]
    if end_label:
        end = re.search(end_label, tail, re.I)
        if end:
            tail = tail[:end.start()]
    return tail[:1500]


def _party(section: str) -> tuple[str, str]:
    if not section:
        return "", ""
    name = _first([
        r"名\s*称\s*[:：]\s*([^\n\r]{2,100}?)(?=\s*(?:统一社会信用代码|纳税人识别号|统一社会信用代码/纳税人识别号|地址|电\s*话|开户行|账\s*号|$))",
        r"(?:BuyerName|PurchaserName|SellerName|TaxpayerName|Name)\s*[:：]\s*([^\n\r]{2,100})",
    ], section, re.I)
    tax_no = _first([
        r"(?:统一社会信用代码\s*/?\s*纳税人识别号|统一社会信用代码|纳税人识别号)\s*[:：]\s*([0-9A-Z]{15,25})",
        r"(?:BuyerTaxNo|PurchaserTaxNo|SellerTaxNo|TaxpayerId|TaxNo|Nsrsbh)\s*[:：]\s*([0-9A-Z]{15,25})",
    ], section, re.I).upper()
    return name, tax_no


def _xml_semantic_value(text: str, keys: tuple[str, ...]) -> str:
    for key in keys:
        value = _first([rf"(?:^|\n){re.escape(key)}\s*[:：]\s*([^\n\r]+)"], text, re.I | re.M)
        if value:
            return value
    return ""


def parse_electronic_invoice_text(text: str, *, direction: str = "output") -> dict[str, Any]:
    raw = str(text or "").replace("\u3000", " ")
    compact = re.sub(r"[ \t]+", " ", raw)
    compact = re.sub(r"\n{3,}", "\n\n", compact)

    invoice_type = ""
    if re.search(r"增值税\s*专用发票", compact):
        invoice_type = "电子发票（增值税专用发票）"
    elif re.search(r"增值税\s*普通发票", compact):
        invoice_type = "电子发票（增值税普通发票）"
    elif re.search(r"数电发票|电子发票", compact):
        invoice_type = "电子发票"

    digital_no = _first([
        r"发票号码\s*[:：]\s*([0-9]{8,30})",
        r"(?:InvoiceNo|InvoiceNumber|Fphm)\s*[:：]\s*([0-9A-Z]{8,30})",
    ], compact, re.I)
    invoice_code = _first([
        r"发票代码\s*[:：]\s*([0-9A-Z]{8,20})",
        r"(?:InvoiceCode|Fpdm)\s*[:：]\s*([0-9A-Z]{8,20})",
    ], compact, re.I)

    invoice_date_raw = _first([
        r"开票日期\s*[:：]\s*([^\n\r]{6,30})",
        r"(?:IssueDate|InvoiceDate|Kprq)\s*[:：]\s*([^\n\r]{6,30})",
    ], compact, re.I)
    invoice_date = normalize_date(invoice_date_raw)

    buyer_section = _party_section(compact, r"购买方(?:信息)?", r"销售方(?:信息)?")
    seller_section = _party_section(compact, r"销售方(?:信息)?", r"项目名称|合\s*计|价税合计|备\s*注")
    buyer_name, buyer_tax_no = _party(buyer_section)
    seller_name, seller_tax_no = _party(seller_section)

    if not buyer_name:
        buyer_name = _xml_semantic_value(compact, (
            "BuyerName", "PurchaserName", "GmfMc", "GhfMc", "BuyerTaxpayerName"
        ))
    if not buyer_tax_no:
        buyer_tax_no = _xml_semantic_value(compact, (
            "BuyerTaxNo", "PurchaserTaxNo", "GmfNsrsbh", "GhfNsrsbh", "BuyerTaxpayerId"
        )).upper()
    if not seller_name:
        seller_name = _xml_semantic_value(compact, (
            "SellerName", "XsfMc", "XhfMc", "SellerTaxpayerName"
        ))
    if not seller_tax_no:
        seller_tax_no = _xml_semantic_value(compact, (
            "SellerTaxNo", "XsfNsrsbh", "XhfNsrsbh", "SellerTaxpayerId"
        )).upper()

    # Fallback for standard PDF layouts where two generic name/tax labels are emitted in order.
    if not (buyer_name and seller_name):
        names = re.findall(
            r"名\s*称\s*[:：]\s*([^\n\r]{2,100}?)(?=\s*(?:统一社会信用代码|纳税人识别号|统一社会信用代码/纳税人识别号))",
            compact,
            re.I,
        )
        if len(names) >= 2:
            buyer_name = buyer_name or _clean_text(names[0])
            seller_name = seller_name or _clean_text(names[1])
    if not (buyer_tax_no and seller_tax_no):
        tax_ids = re.findall(
            r"(?:统一社会信用代码\s*/?\s*纳税人识别号|统一社会信用代码|纳税人识别号)\s*[:：]\s*([0-9A-Z]{15,25})",
            compact,
            re.I,
        )
        if len(tax_ids) >= 2:
            buyer_tax_no = buyer_tax_no or tax_ids[0].upper()
            seller_tax_no = seller_tax_no or tax_ids[1].upper()

    gross_raw = _first([
        rf"[（(]\s*小写\s*[）)]\s*[:：]?\s*[¥￥]?\s*{_MONEY}",
        rf"价税合计(?:\s*[（(]小写[）)])?\s*[:：]?\s*[¥￥]?\s*{_MONEY}",
        rf"(?:TotalAmount|AmountWithTax|Jshj|JshjJe)\s*[:：]\s*{_MONEY}",
    ], compact, re.I)
    gross = _money(gross_raw)

    net: float | None = None
    tax: float | None = None
    total_match = re.search(
        rf"合\s*计\s*[¥￥]?\s*{_MONEY}\s*[¥￥]?\s*{_MONEY}",
        compact,
        re.I,
    )
    if total_match:
        net = _money(total_match.group(1))
        tax = _money(total_match.group(2))
    if net is None:
        net = _money(_first([
            rf"(?:不含税金额|金额合计|合计金额|AmountWithoutTax|NetAmount|Hjje)\s*[:：]\s*[¥￥]?\s*{_MONEY}"
        ], compact, re.I))
    if tax is None:
        tax = _money(_first([
            rf"(?:税额合计|合计税额|TaxAmount|Hjse)\s*[:：]\s*[¥￥]?\s*{_MONEY}"
        ], compact, re.I))

    rate_values = [
        float(item)
        for item in re.findall(r"(?<![0-9.])(0|1|3|5|6|9|10|11|13)(?:\.0+)?\s*%", compact)
    ]
    tax_rate = rate_values[0] if rate_values and len(set(rate_values)) == 1 else (rate_values[0] if rate_values else None)

    if gross is None and net is not None and tax is not None:
        gross = round(net + tax, 2)
    if gross is not None and (net is None or tax is None) and tax_rate is not None:
        derived_net = round(gross / (1 + tax_rate / 100), 2)
        derived_tax = round(gross - derived_net, 2)
        net = derived_net if net is None else net
        tax = derived_tax if tax is None else tax
    if tax_rate is None and net not in (None, 0) and tax is not None:
        tax_rate = round(tax / net * 100, 4)

    issuer = _first([
        r"开票人\s*[:：]\s*([^\s\n\r]{1,40})",
        r"(?:Issuer|Drawer|Kpr)\s*[:：]\s*([^\n\r]{1,40})",
    ], compact, re.I)

    critical = {
        "invoice_number": bool(digital_no or invoice_code),
        "invoice_date": bool(invoice_date),
        "counterparty": bool(buyer_name if direction == "output" else seller_name),
        "counterparty_tax_no": bool(buyer_tax_no if direction == "output" else seller_tax_no),
        "gross_amount": gross is not None and gross > 0,
    }
    confidence = round(sum(1 for value in critical.values() if value) / len(critical), 2)
    warnings: list[str] = []
    if not critical["invoice_number"]:
        warnings.append("未识别到数电发票号码")
    if not critical["invoice_date"]:
        warnings.append("未识别到开票日期")
    if not critical["counterparty"]:
        warnings.append("未识别到交易方名称")
    if not critical["counterparty_tax_no"]:
        warnings.append("未识别到交易方税号")
    if not critical["gross_amount"]:
        warnings.append("未识别到价税合计")

    return {
        "invoice_direction": "input" if direction == "input" else "output",
        "invoice_type": invoice_type or "电子发票（增值税专用发票）",
        "digital_invoice_no": digital_no or None,
        "invoice_code": invoice_code or None,
        "invoice_no": None,
        "buyer_name": buyer_name or None,
        "buyer_tax_no": buyer_tax_no or None,
        "seller_name": seller_name or None,
        "seller_tax_no": seller_tax_no or None,
        "invoice_amount": float(net or 0),
        "tax_amount": float(tax or 0),
        "amount_with_tax": float(gross or 0),
        "tax_rate": tax_rate,
        "invoice_date": invoice_date or None,
        "issuer": issuer or None,
        "invoice_source": "电子发票文件上传",
        "tax_status": "normal",
        "status": "已开",
        "confidence": confidence,
        "warnings": warnings,
    }
