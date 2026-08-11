from app.services.bank_partner_match import normalize_account, normalize_company, normalize_party


def test_normalize_bank_counterparty_company_name():
    assert normalize_party("上海畅指网络科技有限公司") == "上海畅指网络科技有限公司"
    assert normalize_company("上海畅指网络科技有限公司") == "上海畅指网络科技"


def test_normalize_company_handles_punctuation_and_spaces():
    assert normalize_company("  广州触点互娱网络科技有限公司  ") == "广州触点互娱网络科技"
    assert normalize_party("广州触点（互娱）网络科技有限公司") == "广州触点互娱网络科技有限公司"


def test_normalize_bank_account():
    assert normalize_account(" 6212 3456-7890 ") == "621234567890"
