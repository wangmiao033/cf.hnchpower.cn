import unittest
from settlement_recalculator import calculate_channel_contract_amount
from channel_line_verification import normalize_channel_line_fee_check
from samsung_settlement import SAMSUNG_STATEMENT_FEE_RULE as CODE, SAMSUNG_LEGAL_NAME

class SamsungContractTests(unittest.TestCase):
    def setUp(self):
        self.bill=dict(partner_name=SAMSUNG_LEGAL_NAME,channel_name='三星',settlement_rule_code=CODE,channel_fee_mode='fixed',channel_fee_rate=4,tax_mode='none')
        self.line=dict(billing_flow=532,discount_factor=1,gateway_cost=21.08,share_rate=50,tax_rate=6,settlement_amount=255.46,settlement_rule_code=CODE)
        self.contract=dict(share_rate=50,channel_fee_rate=5,invoice_tax_rate=6)
    def test_saved_statement_fee_overrides_generic_five_percent(self):
        result=calculate_channel_contract_amount(self.bill,self.line,self.contract)
        self.assertEqual(result['expected_amount'],255.46)
        self.assertEqual(result['status'],'pass')
        self.assertEqual(result['formula_code'],CODE)
    def test_contract_share_is_still_authoritative(self):
        result=calculate_channel_contract_amount(self.bill,self.line,{**self.contract,'share_rate':40})
        self.assertEqual(result['expected_amount'],204.37)
        self.assertEqual(result['status'],'fail')
    def test_confirmed_customer_short_name_keeps_statement_rule(self):
        result=calculate_channel_contract_amount({**self.bill,'channel_name':'鹏泰博兴'},self.line,self.contract)
        self.assertEqual(result['expected_amount'],255.46)
    def test_original_rows_and_voucher_deduction_recalculate_consistently(self):
        for flow,voucher,fee,expected in [(72,0,2.88,34.56),(460,0,18.2,220.9),(262,47,8.6,103.2)]:
            result=calculate_channel_contract_amount(self.bill,{**self.line,'billing_flow':flow,'voucher_cost':voucher,'gateway_cost':fee,'settlement_amount':expected},self.contract)
            self.assertEqual(result['expected_amount'],expected)
    def test_other_company_fails_closed(self):
        result=calculate_channel_contract_amount({**self.bill,'partner_name':'其他'},self.line,self.contract)
        self.assertIsNone(result['expected_amount'])
        self.assertEqual(result['status'],'manual')
    def test_tax_split_not_deducted_and_fee_record_retained(self):
        source={'checks':[{'key':'channel_fee_rate','status':'fail','bill_value':4,'contract_value':5,'difference':-1},{'key':'tax_rate','status':'fail'},{'key':'share_rate','status':'fail'}], 'contract_amount':{'status':'pass'}}
        result=normalize_channel_line_fee_check(source,{**self.bill,**self.line})
        self.assertEqual(result['checks'][0]['status'],'pass')
        self.assertEqual(result['checks'][0]['contract_value'],5)
        self.assertEqual(result['checks'][0]['difference'],-1)
        self.assertEqual(result['checks'][1]['status'],'pass')
        self.assertEqual(result['status'],'fail')
        other=normalize_channel_line_fee_check(source,{**self.bill,**self.line,'partner_name':'其他'})
        self.assertEqual(other['checks'][1]['status'],'fail')
    def test_no_special_rule_keeps_generic_calculation(self):
        result=calculate_channel_contract_amount({**self.bill,'settlement_rule_code':'five_percent_gateway_share','channel_fee_mode':'percent','channel_fee_rate':5},{**self.line,'settlement_rule_code':'five_percent_gateway_share'},self.contract)
        self.assertEqual(result['expected_amount'],252.7)
    def test_invalid_fee_cannot_claim_deterministic_pass(self):
        result=calculate_channel_contract_amount(self.bill,{**self.line,'gateway_cost':600},self.contract)
        self.assertFalse(result['deterministic'])
    def test_v14_wrapper_and_v3_snapshot_keep_samsung_path(self):
        import v14_main
        result=v14_main._calculate_channel_contract_amount_with_anjiu_order(self.bill,self.line,self.contract)
        self.assertEqual(result['expected_amount'],255.46)

if __name__=='__main__':unittest.main()
