import unittest
from uuid import uuid4
from unittest.mock import patch
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy.orm import Session
from sqlalchemy import insert, update
from tests.test_self_operated_orders import SelfOperatedLedgerTest, _payload
from app.models.self_operated_month import SelfOperatedMonth, SelfOperatedMonthSave
from app.models.reconciliation import ReconciliationRecord, ReconciliationLineItem
from app.schemas.self_operated_month import MonthSave
from app.services.self_operated_month import read_month, save_month
from app.services.self_operated_orders import confirm_order_import

class MonthTest(SelfOperatedLedgerTest):
    def setUp(self):
        super().setUp()
        for model in (SelfOperatedMonth,SelfOperatedMonthSave,ReconciliationRecord,ReconciliationLineItem):
            model.__table__.create(self.engine)
    def payload(self,**overrides):
        row=dict(game_id='',game_name='Test game',cash_cents=12345,refund_cents=None,fee_cents=None,received_cents=None,rd_line_id=None,status='pending')
        return MonthSave.model_validate(dict(request_key=str(uuid4()),revision=0,confirmed=True,rows=[row],**overrides))
    def test_null_and_cross_session(self):
        p=self.payload();save_month(self.db,'2026-09',p,'admin-1');self.db.commit()
        with Session(self.engine) as other:
            result=read_month(other,'2026-09')
            self.assertEqual(result['revision'],1)
            self.assertEqual(result['rows'][0]['cash_cents'],12345)
            self.assertIsNone(result['rows'][0]['received_cents'])
            self.assertIsNone(result['rows'][0]['rd_cents'])
    def test_api_auth_and_server_round_trip(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from app.api.self_operated import router
        from app.core.deps import get_db
        from app.core.security import require_current_user
        from app.models.user import AuthUser
        app=FastAPI();app.include_router(router,prefix='/api/self-operated')
        app.dependency_overrides[get_db]=lambda:self.db
        with TestClient(app) as client:
            path='/api/self-operated/ledger/2026-09'
            self.assertEqual(client.get(path).status_code,401)
            app.dependency_overrides[require_current_user]=lambda:AuthUser(id='staff',role='user')
            self.assertEqual(client.get(path).status_code,403)
            self.assertEqual(client.post(path,json=self.payload().model_dump(mode='json')).status_code,403)
            app.dependency_overrides[require_current_user]=lambda:self.db.get(AuthUser,'admin-1')
            response=client.post(path,json=self.payload().model_dump(mode='json'))
            self.assertEqual(response.status_code,200,response.text)
            self.assertEqual(client.get(path).json()['rows'][0]['cash_cents'],12345)
    def test_replay_and_stale_save(self):
        p=self.payload();save_month(self.db,'2026-09',p,'admin-1');self.db.commit()
        self.assertTrue(save_month(self.db,'2026-09',p,'admin-1')['replayed'])
        with self.assertRaises(HTTPException) as error:save_month(self.db,'2026-09',self.payload(),'admin-1')
        self.assertEqual(error.exception.status_code,409)
    def test_failure_rolls_back(self):
        p=self.payload();save_month(self.db,'2026-09',p,'admin-1');self.db.rollback()
        self.assertEqual(read_month(self.db,'2026-09')['rows'],[])
    def test_incomplete_cannot_check(self):
        p=self.payload();p.rows[0].status='checked'
        with self.assertRaises(HTTPException):save_month(self.db,'2026-09',p,'admin-1')
    def test_precision(self):
        p=self.payload().model_dump();p['rows'][0]['received_cents']=1.2
        with self.assertRaises(ValidationError):MonthSave.model_validate(p)
    def test_gate(self):
        with patch.dict('os.environ',{'DAXIONG_ORDERS_WRITES_ENABLED':'false'}):
            with self.assertRaises(HTTPException) as error:save_month(self.db,'2026-09',self.payload(),'admin-1')
            self.assertEqual(error.exception.status_code,503)
    def test_manual_cash_blocks_import(self):
        p=self.payload();p.rows[0].game_id='124';save_month(self.db,'2026-08',p,'admin-1');self.db.commit()
        with self.assertRaises(HTTPException) as error:confirm_order_import(self.db,_payload(),user_id='admin-1')
        self.assertEqual(error.exception.status_code,409)
    def test_rd_reference_and_changed_amount_invalidates_check(self):
        # Seed an already-confirmed historical record in the isolated test DB.
        self.db.execute(insert(ReconciliationRecord).values(id='rd1',statement_no='TEST-1',settlement_month='2026-09',status='confirmed'))
        self.db.execute(insert(ReconciliationLineItem).values(id='line1',reconciliation_id='rd1',game_name='Test game',settlement_amount=12.34));self.db.commit()
        p=self.payload();r=p.rows[0];r.refund_cents=0;r.fee_cents=0;r.received_cents=100;r.rd_line_id='line1';r.expected_rd_cents=1234;r.status='checked'
        save_month(self.db,'2026-09',p,'admin-1');self.db.commit()
        self.assertEqual(read_month(self.db,'2026-09')['rows'][0]['status'],'checked')
        self.db.execute(update(ReconciliationLineItem).where(ReconciliationLineItem.id=='line1').values(settlement_amount=13));self.db.commit()
        self.assertEqual(read_month(self.db,'2026-09')['rows'][0]['status'],'pending')

if __name__=='__main__':unittest.main()
