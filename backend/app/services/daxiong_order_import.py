"""大熊游戏原始 CSV 订单入账前严格验证。业务口径与审计以服务端结果为准。"""

from __future__ import annotations

import csv
import hashlib
import io
import re
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation
from pathlib import PurePath

MAX_SOURCE_BYTES = 3 * 1024 * 1024
MAX_SOURCE_ROWS = 30000
MAX_ORDER_CENTS = 100000000000

_ORDER_ALIASES: dict[str, tuple[str, ...]] = {
    "order_id": ("订单号", "订单编号", "订单ID", "交易订单号", "商户订单号", "支付订单号"),
    "paid_cents": ("实付金额", "现金实付", "实际支付", "实际支付金额", "支付金额", "实收金额"),
    "paid_date": ("支付时间", "支付日期", "付款时间", "充值时间", "订单时间", "创建时间", "交易时间"),
    "game_name": ("游戏名称", "游戏名", "游戏", "产品名称", "产品名"),
    "game_id": ("游戏ID", "游戏编号", "产品ID", "产品编号"),
    "status": ("支付状态", "订单状态", "交易状态", "充值状态", "状态"),
    "kind": ("订单类型", "业务类型", "交易类型", "充值类型", "类型"),
    "payment_method": ("支付方式", "付款方式", "支付渠道", "支付类型"),
}

_STRICT_REQUIRED = ("order_id", "paid_cents", "paid_date", "status", "kind")
_AMOUNT_FORMAT = re.compile(r"^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$")
_MONTH = re.compile(r"^20\d{2}-(?:0[1-9]|1[0-2])$")


class OrderImportRejected(ValueError):
    """Do not insert any records from a bad or ambiguous file."""


def _name(value: object) -> str:
    return re.sub(r"[\s\u3000_/\-\\:：\[\]【】().（）]+", "", str(value or "").lstrip("\ufeff")).lower()


def _columns(headers: list[str]) -> dict[str, str]:
    normalized = {_name(header): header for header in headers if header}
    mapping: dict[str, str] = {}
    for field, aliases in _ORDER_ALIASES.items():
        for alias in aliases:
            if _name(alias) in normalized:
                mapping[field] = normalized[_name(alias)]
                break
    absent = [field for field in _STRICT_REQUIRED if field not in mapping]
    if absent or not any(field in mapping for field in ("game_name", "game_id")):
        raise OrderImportRejected("缺少入账所需订单号、实付金额、支付日期、支付状态、订单类型或游戏信息；请使用已核对的 CSV")
    return mapping


def _date(value: object, row_no: int) -> date:
    text = str(value or "").strip()
    match = re.match(r"^(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})(?:日|[T\s:]|$)", text)
    if not match:
        match = re.match(r"^(20\d{2})(\d{2})(\d{2})(?:\D|$)", text)
    if not match:
        raise OrderImportRejected(f"第{row_no}行支付日期格式异常")
    try:
        return date(int(match[1]), int(match[2]), int(match[3]))
    except ValueError as exc:
        raise OrderImportRejected(f"第{row_no}行支付日期无效") from exc


def _cents(value: object, row_no: int) -> int:
    raw = str(value or "").strip().replace("¥", "").replace("￥", "").replace("元", "").replace(" ", "")
    if not _AMOUNT_FORMAT.fullmatch(raw):
        raise OrderImportRejected(f"第{row_no}行实付金额格式不符合财务分精度")
    try:
        value_decimal = Decimal(raw.replace(",", ""))
        cents_decimal = value_decimal * 100
        result = int(cents_decimal)
    except (InvalidOperation, ValueError) as exc:
        raise OrderImportRejected(f"第{row_no}行金额无法解析") from exc
    if cents_decimal != result or not 0 <= result <= MAX_ORDER_CENTS:
        raise OrderImportRejected(f"第{row_no}行金额不在允许的分精度区间")
    return result


def _state(value: object) -> str:
    value = str(value or "").strip().lower()
    if not value:
        return "review"
    if re.search(r"退款|退单|撤销|已取消|失败|未支付|待支付|未付款|作废|关闭|未完成|refund|failed|cancel|pending|unpaid|closed", value):
        return "excluded"
    if re.search(r"支付成功|已支付|已付款|交易成功|交易完成|收款成功|已收款|已到账|已完成|success|paid|complete|settled", value):
        return "paid"
    return "review"


def _kind(value: object) -> str:
    value = str(value or "").strip().lower()
    if re.search(r"竹b|竹币|竹幣|代币充值|虚拟币充值|coin.*topup", value):
        return "coin"
    if re.search(r"游戏充值|游戏直充|现金充值|游戏订单|game|recharge", value):
        return "game"
    return "review"


def _text(value: object, *, limit: int, field: str, row_no: int) -> str:
    result = str(value or "").strip()
    if len(result) > limit or "\x00" in result:
        raise OrderImportRejected(f"第{row_no}行{field}长度或字符无效")
    return result


@dataclass(frozen=True)
class OrderItem:
    order_id: str
    paid_date: date
    paid_month: str
    game_external_id: str
    game_name: str
    cash_paid_cents: int
    order_kind: str
    payment_method: str
    fingerprint: str


@dataclass(frozen=True)
class ParsedOrderFile:
    filename: str
    sha256: str
    raw: bytes
    records_read: int
    excluded: int
    duplicate_in_file: int
    orders: tuple[OrderItem, ...]
    game_cash_cents: int
    coin_topup_cents: int

    @property
    def eligible_count(self) -> int:
        return len(self.orders)


def parse_audited_csv(filename: str, blob: bytes) -> ParsedOrderFile:
    """Parses cleaned source CSV afresh on the server; never trusts browser totals."""
    original_name = PurePath(str(filename or "").replace("\\", "/")).name[:180]
    if not original_name.lower().endswith(".csv"):
        raise OrderImportRejected("正式保存暂时只接受核对后的CSV文件，Excel可先在浏览器预览")
    if not blob or len(blob) > MAX_SOURCE_BYTES:
        raise OrderImportRejected("原始文件为空或超过3MB，请按月拆分")

    try:
        source = blob.decode("utf-8-sig")
    except UnicodeDecodeError:
        try:
            source = blob.decode("gb18030")
        except UnicodeDecodeError as exc:
            raise OrderImportRejected("CSV字符编码无法识别") from exc

    reader = csv.DictReader(io.StringIO(source, newline=""))
    headers = reader.fieldnames or []
    if len(headers) != len(set(headers)) or len(headers) > 80:
        raise OrderImportRejected("CSV存在重复或过多列名，请修复源文件")
    fields = _columns(headers)
    result: dict[str, OrderItem] = {}
    seen = 0
    excluded = 0
    duplicates = 0

    for number, row in enumerate(reader, 2):
        if not any(str(value or "").strip() for value in row.values()):
            continue
        seen += 1
        if seen > MAX_SOURCE_ROWS:
            raise OrderImportRejected("最多保存30,000行订单，请分批处理")
        if None in row:
            raise OrderImportRejected(f"第{number}行的字段数量超过表头，请修复CSV")

        order_id = _text(row.get(fields["order_id"]), limit=160, field="订单号", row_no=number)
        if not order_id or re.search(r"\d[eE][+]\d+", order_id):
            raise OrderImportRejected(f"第{number}行订单号缺失或已被科学计数法破坏")

        status = _state(row.get(fields["status"]))
        kind = _kind(row.get(fields["kind"]))
        method = _text(row.get(fields["payment_method"]), limit=120, field="支付方式", row_no=number) if "payment_method" in fields else ""
        if status == "review" or kind == "review":
            raise OrderImportRejected(f"第{number}行支付状态或订单类型无法确认，请先核对")

        if status == "excluded" or (kind == "game" and re.search(r"竹b|竹币|竹幣", method.lower())):
            excluded += 1
            continue

        paid_cents = _cents(row.get(fields["paid_cents"]), number)
        if paid_cents == 0:
            raise OrderImportRejected(f"第{number}行已支付金额为零，无法确认真实现金入账")

        paid_date = _date(row.get(fields["paid_date"]), number)
        game_id = _text(row.get(fields["game_id"]), limit=120, field="游戏ID", row_no=number) if "game_id" in fields else ""
        game_name = _text(row.get(fields["game_name"]), limit=250, field="游戏名称", row_no=number) if "game_name" in fields else ""
        if not game_name:
            game_name = "竹B现金充值" if kind == "coin" else "游戏ID " + game_id
        if not game_name or (kind == "game" and not game_id and game_name == "游戏ID "):
            raise OrderImportRejected(f"第{number}行游戏身份缺失")

        key_parts = [order_id, paid_date.isoformat(), game_id, game_name, str(paid_cents), kind, method]
        fingerprint = hashlib.sha256("\x1f".join(key_parts).encode("utf-8")).hexdigest()
        item = OrderItem(
            order_id=order_id, paid_date=paid_date, paid_month=paid_date.strftime("%Y-%m"),
            game_external_id=game_id, game_name=game_name, cash_paid_cents=paid_cents,
            order_kind=kind, payment_method=method, fingerprint=fingerprint,
        )
        previous = result.get(order_id)
        if previous is not None:
            if previous != item:
                raise OrderImportRejected(f"第{number}行订单号与同文件已有订单发生金额、日期或类型冲突")
            duplicates += 1
        else:
            result[order_id] = item

    if seen == 0 or not result:
        raise OrderImportRejected("未找到可保存的有效现金订单")
    game_cents = sum(r.cash_paid_cents for r in result.values() if r.order_kind == "game")
    coin_cents = sum(r.cash_paid_cents for r in result.values() if r.order_kind == "coin")
    return ParsedOrderFile(
        filename=original_name, sha256=hashlib.sha256(blob).hexdigest(), raw=blob,
        records_read=seen, excluded=excluded+duplicates, duplicate_in_file=duplicates,
        orders=tuple(result.values()), game_cash_cents=game_cents, coin_topup_cents=coin_cents,
    )
