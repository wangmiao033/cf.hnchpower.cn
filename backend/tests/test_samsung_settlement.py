import unittest
from decimal import Decimal
from types import SimpleNamespace
from fastapi import HTTPException
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session
from app.api.channel import create_channel_record, get_channel_record, update_channel_record
from app.models.channel import ChannelRecord, ChannelRecordLineItem, ChannelReceipt
from app.schemas.channel import ChannelRecordCreate, ChannelRecordUpdate, ChannelLineItemCreate
from app.services.channel_settlement_engine import calculate_channel_line
from contract_terms.samsung_settlement import SAMSUNG_STATEMENT_FEE_RULE as CODE, SAMSUNG_LEGAL_NAME

RULE = dict(settlement_rule_code=CODE, channel_fee_mode="fixed", channel_fee_rate=4, tax_mode="none")

def line(flow=532, fee=21.08, platform=255.46, **kw):
    data=dict(game_name="合成游戏",settlement_cycle="2026-07",billing_flow=flow,gateway_cost=fee,share_rate=50,tax_rate=6,platform_settlement_amount=platform,**RULE)
    data.update(kw)
    return ChannelLineItemCreate(**data)

class SamsungSettlementTests(unittest.TestCase):
    def setUp(self):
        self.engine=create_engine("sqlite+pysqlite:///:memory:")
        for model in (ChannelRecord,ChannelRecordLineItem,ChannelReceipt): model.__table__.create(self.engine)
        self.db=Session(self.engine)
        self.db.execute(text("CREATE TABLE cf_partner_records (id TEXT PRIMARY KEY, name TEXT, short_name TEXT)"))
        self.db.execute(text("INSERT INTO cf_partner_records VALUES ('synthetic-samsung',:name,'三星')"),{'name':SAMSUNG_LEGAL_NAME})
        self.db.commit()
    def tearDown(self):
        self.db.close();self.engine.dispose()
    def create(self,items=None,**kw):
        data=dict(partner_name=SAMSUNG_LEGAL_NAME,channel_name='三星',settlement_month='2026-07',items=items or [line()],**RULE)
        data.update(kw)
        return create_channel_record(ChannelRecordCreate(**data),self.db)
    def payload(self,saved):
        return {key:getattr(saved,key) for key in ChannelLineItemCreate.model_fields}
    def test_original_rows_tax_and_merged_games(self):
        for flow,fee,expected in [(72,2.88,34.56),(215,8.6,103.2),(460,18.2,220.9)]:
            result=calculate_channel_line(line(flow,fee,expected),SimpleNamespace(partner_name=SAMSUNG_LEGAL_NAME,channel_name='三星',**RULE))
            self.assertEqual(result['system_settlement_amount'],Decimal(str(expected)))
        result=self.create([line(),line(262,8.6,103.2,voucher_cost=47)])
        self.assertEqual(result.system_settlement_amount,358.66)
        self.assertEqual(result.gateway_cost,29.68)
        self.assertEqual(result.received_amount,0)
    def test_confirmed_customer_short_name_is_valid_channel_identity(self):
        self.assertEqual(self.create(channel_name='鹏泰博兴').system_settlement_amount,255.46)
        with self.assertRaises(HTTPException): self.create(partner_name='其他公司',channel_name='鹏泰博兴')
    def test_real_database_roundtrip_and_header_recalculation(self):
        result=self.create()
        reopened=get_channel_record(result.id,self.db)
        self.assertEqual(reopened.items[0].gateway_cost,21.08)
        self.assertEqual(reopened.items[0].settlement_rule_code,CODE)
        updated=update_channel_record(result.id,ChannelRecordUpdate(validation_tolerance=.02),self.db)
        self.assertEqual(updated.system_settlement_amount,255.46)
        self.assertEqual(updated.items[0].gateway_cost,21.08)
    def test_old_client_omissions_preserved_by_line_id(self):
        result=self.create()
        payload=self.payload(result.items[0])
        for key in (*RULE,'gateway_cost'): payload.pop(key)
        payload['billing_flow']=534
        updated=update_channel_record(result.id,ChannelRecordUpdate(items=[payload]),self.db)
        self.assertEqual(updated.items[0].gateway_cost,21.08)
        self.assertEqual(updated.items[0].settlement_rule_code,CODE)
        self.assertEqual(updated.system_settlement_amount,256.46)
    def test_generic_contract_cannot_overwrite_saved_rule(self):
        result=self.create();payload=self.payload(result.items[0]);payload['settlement_rule_code']='five_percent_gateway_share'
        with self.assertRaises(HTTPException): update_channel_record(result.id,ChannelRecordUpdate(items=[payload]),self.db)
        self.db.rollback()
        self.assertEqual(get_channel_record(result.id,self.db).system_settlement_amount,255.46)
    def test_missing_stable_id_rejected(self):
        result=self.create();payload=self.payload(result.items[0]);payload.pop('id')
        with self.assertRaises(HTTPException): update_channel_record(result.id,ChannelRecordUpdate(items=[payload]),self.db)
    def test_other_legal_names_and_channels_rejected_before_write(self):
        for data in [dict(partner_name='鹏泰博兴'),dict(partner_name=SAMSUNG_LEGAL_NAME+'分公司'),dict(channel_name='4197'),dict(channel_name='三星测试')]:
            with self.subTest(data=data),self.assertRaises(HTTPException): self.create(**data)
        self.assertEqual(self.db.query(ChannelRecord).count(),0)
    def test_ambiguous_customer_fails_closed(self):
        self.db.execute(text("INSERT INTO cf_partner_records VALUES ('duplicate',:name,'其他')"),{'name':SAMSUNG_LEGAL_NAME});self.db.commit()
        with self.assertRaises(HTTPException): self.create()
    def test_invalid_fee_or_missing_explicit_amount_rejected(self):
        for fee in [-1,533,float('nan'),float('inf'),1.001]:
            with self.subTest(fee=fee),self.assertRaises(HTTPException): self.create([line(fee=fee)])
        data=line().model_dump();data.pop('gateway_cost')
        with self.assertRaises(HTTPException): self.create([ChannelLineItemCreate(**data)])
    def test_zero_explicitly_valid_and_no_five_yuan_monthly_constant(self):
        self.assertEqual(self.create([line(100,0,50)]).system_settlement_amount,50)
        self.assertEqual(self.create([line(460,18.4,220.8)]).system_settlement_amount,220.8)
    def test_historical_and_other_channels_unchanged(self):
        old=dict(settlement_rule_code='five_percent_gateway_share',channel_fee_mode='percent',channel_fee_rate=5,tax_mode='none')
        for partner,channel in [(SAMSUNG_LEGAL_NAME,'三星'),('合成其他公司','4197')]:
            result=self.create([line(**old)],partner_name=partner,channel_name=channel,**old)
            self.assertEqual(result.system_settlement_amount,252.70)
            self.assertEqual(get_channel_record(result.id,self.db).system_settlement_amount,252.70)
    def test_changing_saved_identity_rejected(self):
        result=self.create()
        with self.assertRaises(HTTPException): update_channel_record(result.id,ChannelRecordUpdate(channel_name='4197'),self.db)

    def test_existing_legacy_bill_changes_only_after_explicit_opt_in(self):
        old=dict(settlement_rule_code='five_percent_gateway_share',channel_fee_mode='percent',channel_fee_rate=5,tax_mode='none')
        result=self.create([line(**old),line(262,0,103.2,voucher_cost=47,**old)],**old)
        self.assertEqual(result.system_settlement_amount,354.83)
        items=[{**self.payload(saved),**RULE,'gateway_cost':fee} for saved,fee in zip(result.items,[21.08,8.6])]
        updated=update_channel_record(result.id,ChannelRecordUpdate(items=items,**RULE),self.db)
        self.assertEqual(updated.system_settlement_amount,358.66)
        self.assertEqual(updated.received_amount,0)
        self.assertEqual(get_channel_record(result.id,self.db).gateway_cost,29.68)

    def test_explicit_new_row_can_be_added_while_existing_identity_is_kept(self):
        result=self.create()
        updated=update_channel_record(result.id,ChannelRecordUpdate(items=[self.payload(result.items[0]),line(215,8.6,103.2).model_dump(exclude_unset=True)]),self.db)
        self.assertEqual(updated.system_settlement_amount,358.66)
    def test_header_fee_refresh_cannot_change_samsung_snapshot(self):
        result=self.create()
        with self.assertRaises(HTTPException): update_channel_record(result.id,ChannelRecordUpdate(channel_fee_rate=5),self.db)
    def test_independent_service_formula_copies_agree(self):
        from app.services.samsung_settlement import samsung_billing_base as core_formula
        from contract_terms.samsung_settlement import samsung_billing_base as contract_formula
        for base, fee in [(532,21.08),(215,8.6),(72,2.88),(460,18.2),(1,0)]:
            self.assertEqual(core_formula(base,fee),contract_formula(base,fee))

class SamsungContractBindingTests(unittest.TestCase):
    def setUp(self):
        from test_channel_contract_binding import ChannelContractBindingTests
        self.fixture=ChannelContractBindingTests();self.fixture.setUp();self.db=self.fixture.db
        self.db.execute(text("UPDATE cf_partner_records SET name=:name,short_name='三星' WHERE id='p1'"),{'name':SAMSUNG_LEGAL_NAME})
        self.db.execute(text("UPDATE cf_contract_access_items SET channel_name='三星',share_rate=50,channel_fee_rate=5 WHERE contract_id='c1'"));self.db.commit()
    def tearDown(self):self.fixture.tearDown()
    def create(self,**changes):
        item=line(game_name='一起来修仙005折',contract_access_item_id='a1',**changes)
        return create_channel_record(ChannelRecordCreate(partner_name=SAMSUNG_LEGAL_NAME,channel_name='三星',settlement_month='2026-07',items=[item],**RULE),self.db)
    def test_contract_fee_five_preserved_while_actual_statement_fee_roundtrips(self):
        saved=self.create();reopened=get_channel_record(saved.id,self.db)
        self.assertEqual(reopened.items[0].contract_access_item_id,'a1')
        self.assertEqual(reopened.system_settlement_amount,255.46)
        self.assertEqual(self.db.execute(text("SELECT channel_fee_rate FROM cf_contract_access_items WHERE id='a1'")).scalar(),5)
    def test_share_and_contract_period_guards_remain(self):
        with self.assertRaises(HTTPException):self.create(share_rate=40)
        self.db.rollback()
        with self.assertRaises(HTTPException):self.create(settlement_cycle='2019-01')
        self.assertEqual(self.db.query(ChannelRecord).count(),0)

if __name__=='__main__':unittest.main()
