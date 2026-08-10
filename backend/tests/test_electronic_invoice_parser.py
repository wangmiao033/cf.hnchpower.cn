from app.services.electronic_invoice_parser import parse_electronic_invoice_text


def test_parse_standard_electronic_special_invoice_text():
    text = """
    电子发票（增值税专用发票）
    发票号码：26442000002619268196
    开票日期：2026年03月11日
    购买方信息
    名称：上海趣淘网络科技有限公司
    统一社会信用代码/纳税人识别号：91310230MA1JWG1F37
    销售方信息
    名称：广州熊动科技有限公司
    统一社会信用代码/纳税人识别号：91440104MABURP0XXA
    项目名称 *信息系统服务*信息服务 数量 1 单价 1080.2358490566 金额 1080.24 税率 6% 税额 64.81
    合计 ¥1080.24 ¥64.81
    价税合计（大写）壹仟壹佰肆拾伍元零伍分 （小写）¥1145.05
    开票人：马纯敏
    """
    row = parse_electronic_invoice_text(text, direction="output")
    assert row["invoice_type"] == "电子发票（增值税专用发票）"
    assert row["digital_invoice_no"] == "26442000002619268196"
    assert row["invoice_date"] == "2026-03-11"
    assert row["buyer_name"] == "上海趣淘网络科技有限公司"
    assert row["buyer_tax_no"] == "91310230MA1JWG1F37"
    assert row["seller_name"] == "广州熊动科技有限公司"
    assert row["seller_tax_no"] == "91440104MABURP0XXA"
    assert row["invoice_amount"] == 1080.24
    assert row["tax_amount"] == 64.81
    assert row["amount_with_tax"] == 1145.05
    assert row["tax_rate"] == 6
    assert row["issuer"] == "马纯敏"
    assert row["confidence"] == 1


def test_derives_net_and_tax_from_gross_and_rate():
    text = """
    电子发票（增值税专用发票）
    发票号码：26442000002619268196
    开票日期：2026年03月11日
    购买方信息 名称：上海趣淘网络科技有限公司 纳税人识别号：91310230MA1JWG1F37
    销售方信息 名称：广州熊动科技有限公司 纳税人识别号：91440104MABURP0XXA
    税率 6%
    价税合计（小写）¥1145.05
    """
    row = parse_electronic_invoice_text(text, direction="output")
    assert row["invoice_amount"] == 1080.24
    assert row["tax_amount"] == 64.81
