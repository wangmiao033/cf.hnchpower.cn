"""大熊游戏后台 CSV 解析。只保存业务必需字段，不导入玩家账号和手机号。"""

from __future__ import annotations

import csv
import hashlib
import io
from datetime import datetime
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

MAX_IMPORT_BYTES = 10 * 1024 * 1024
GAME_FIELDS = {"订单ID", "创建时间", "游戏ID", "游戏名称", "充值金额", "实收金额", "支付方式", "状态"}
TOKEN_FIELDS = {"订单号", "充值时间", "游戏ID", "游戏名称", "订单金额", "实际支付", "充值状态", "支付方式"}
CENT = Decimal("0.01")


class ImportValidationError(ValueError):
    pass


def amount(value: str, field: str, line: int) -> Decimal:
    try:
        number = Decimal(str(value or "0").replace(",", "").strip()).quantize(CENT, rounding=ROUND_HALF_UP)
    except (InvalidOperation, ValueError) as exc:
        raise ImportValidationError(f"第{line}行的{field}不是有效金额") from exc
    if not number.is_finite() or number < 0 or number > Decimal("1000000000"):
        raise ImportValidationError(f"第{line}行的{field}超出允许范围")
    return number


def parse_orders(name: str, content: bytes) -> dict:
    """严格校验表头、日期、金额；原文件相同订单号冲突即拒绝整次导入。"""
    if not name.lower().endswith(".csv"):
        raise ImportValidationError("只能导入大熊后台导出的 CSV 文件")
    if not content or len(content) > MAX_IMPORT_BYTES:
        raise ImportValidationError("文件为空或超过10MB")
    try:
        source = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        source = content.decode("gb18030")
    reader = csv.DictReader(io.StringIO(source, newline=""))
    headers = set(reader.fieldnames or [])
    if GAME_FIELDS <= headers:
        kind = "game"
        order_field, date_field, gross_field, paid_field, status_field = "订单ID", "创建时间", "充值金额", "实收金额", "状态"
    elif TOKEN_FIELDS <= headers:
        kind = "token"
        order_field, date_field, gross_field, paid_field, status_field = "订单号", "充值时间", "订单金额", "实际支付", "充值状态"
    else:
        raise ImportValidationError("表头无法识别：需要游戏订单或代币充值完整字段")
    orders = {}
    for line, row in enumerate(reader, 2):
        if not any(str(v or "").strip() for v in row.values()):
            continue
        order_no = str(row.get(order_field) or "").strip()
        game_id = str(row.get("游戏ID") or "").strip()
        game_name = str(row.get("游戏名称") or "").strip()
        if not order_no or not game_id or not game_name:
            raise ImportValidationError(f"第{line}行缺少订单ID、游戏ID或游戏名称")
        raw_time = str(row.get(date_field) or "").strip()
        try:
            order_time = datetime.strptime(raw_time, "%Y-%m-%d %H:%M:%S" if len(raw_time) == 19 else "%Y-%m-%d %H:%M")
        except ValueError as exc:
            raise ImportValidationError(f"第{line}行日期格式错误") from exc
        gross = amount(row.get(gross_field), gross_field, line)
        paid = amount(row.get(paid_field), paid_field, line)
        record = {
            "order_kind": kind,
            "order_no": order_no,
            "settlement_month": order_time.strftime("%Y-%m"),
            "order_time": order_time,
            "game_external_id": game_id,
            "game_name": game_name,
            "payment_method": str(row.get("支付方式") or "").strip(),
            "payment_status": str(row.get(status_field) or "").strip(),
            "face_amount": gross,
            "paid_amount": paid,
        }
        prior = orders.get(order_no)
        if prior is not None and prior != record:
            raise ImportValidationError(f"第{line}行订单号重复且内容冲突：{order_no}")
        orders[order_no] = record
        if len(orders) > 200000:
            raise ImportValidationError("单次最多导入20万笔订单")
    if not orders:
        raise ImportValidationError("没有可导入的订单")
    months = sorted({r["settlement_month"] for r in orders.values()})
    if len(months) > 12:
        raise ImportValidationError("单次文件跨越月份过多，请按账期导出")
    return {
        "kind": kind,
        "digest": hashlib.sha256(content).hexdigest(),
        "filename": name.rsplit("/", 1)[-1][:180],
        "orders": list(orders.values()),
        "months": months,
    }


def summarize_orders(orders: list[dict]) -> dict:
    """现金、代币充值和竹B消耗分开，不重复确认为营业收入。"""
    cash = Decimal("0")
    token = Decimal("0")
    bamboo = Decimal("0")
    game_totals = {}
    count = 0
    for order in orders:
        if order["payment_status"] != "支付成功":
            continue
        paid = Decimal(str(order["paid_amount"]))
        if order["order_kind"] == "token":
            token += paid
            continue
        if order["payment_method"] == "竹B":
            bamboo += paid
            continue
        cash += paid
        count += 1
        key = (order["game_external_id"], order["game_name"])
        game_totals[key] = game_totals.get(key, Decimal("0")) + paid
    return {
        "cash_paid": cash.quantize(CENT),
        "cash_order_count": count,
        "token_recharged": token.quantize(CENT),
        "bamboo_consumed": bamboo.quantize(CENT),
        "games": [
            {"game_external_id": id_, "game_name": name, "cash_paid": value.quantize(CENT)}
            for (id_, name), value in sorted(game_totals.items(), key=lambda x: (-x[1], x[0][0]))
        ],
    }
