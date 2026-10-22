"""Nullable independent amounts, optimistic versioning, idempotent saves and read-only RD links."""
import hashlib
import json
import re
from decimal import Decimal
from fastapi import HTTPException
from sqlalchemy import select, func, inspect, text
from app.models.self_operated import SelfOperatedOrder
from app.models.self_operated_month import SelfOperatedMonth, SelfOperatedMonthSave
from app.models.reconciliation import ReconciliationRecord, ReconciliationLineItem
from app.services.self_operated_orders import readiness

def key(row):
    return ('id:' + row['game_id']) if row['game_id'] else ('name:' + row['game_name'])

def validate_month(month):
    if not re.fullmatch(r'20\d{2}-(0[1-9]|1[0-2])',month):
        raise HTTPException(422,'账期格式必须为 YYYY-MM')

def monthly_ready(db):
    schema,write,reason=readiness(db)
    inspector=inspect(db.get_bind())
    schema=schema and all(inspector.has_table(t) for t in ('self_operated_months','self_operated_month_saves'))
    return schema, bool(schema and write), reason if schema else 'schema_not_installed'

def lock(db):
    if db.get_bind().dialect.name=='postgresql':
        db.execute(text("SELECT pg_advisory_xact_lock(hashtext('daxiong_order_import_v1'))"))

def order_cash(db,month):
    rows=db.execute(select(SelfOperatedOrder).where(SelfOperatedOrder.settlement_month==month,SelfOperatedOrder.order_kind=='game')).scalars().all()
    result={}
    for row in rows:
        identity={'game_id':row.game_id,'game_name':row.game_name}
        k=key(identity)
        item=result.setdefault(k,{**identity,'cash_cents':0})
        item['cash_cents']+=row.amount_cents
    return result

def rd_options(db,month,game_name):
    # Exact existing line + period + game only. No name heuristics or new liabilities.
    rows=db.execute(select(ReconciliationLineItem,ReconciliationRecord.statement_no)
        .join(ReconciliationRecord,ReconciliationLineItem.reconciliation_id==ReconciliationRecord.id)
        .where(func.coalesce(func.nullif(ReconciliationLineItem.settlement_cycle,''),ReconciliationRecord.settlement_month)==month,
               ReconciliationLineItem.game_name==game_name,
               ReconciliationRecord.status.in_(['confirmed','invoiced','completed','settled','reconciled','verified']))).all()
    return [{'id':line.id,'label':number,'amount_cents':int(Decimal(str(line.settlement_amount))*100)}
            for line,number in rows if line.settlement_amount is not None and Decimal(str(line.settlement_amount))>=0]

def read_month(db,month):
    validate_month(month)
    schema,write,reason=monthly_ready(db)
    if not schema: return {'month':month,'revision':0,'rows':[],'schema_ready':False,'write_ready':False,'reason':reason}
    doc=db.get(SelfOperatedMonth,month)
    saved={key(r):r for r in (doc.rows if doc else [])}
    cash=order_cash(db,month)
    result=[]
    for k in sorted(saved.keys() | cash.keys()):
        row=dict(saved.get(k) or {**cash[k],'cash_cents':None,'refund_cents':None,'fee_cents':None,'received_cents':None,'rd_line_id':None,'status':'pending'})
        actual=cash[k]['cash_cents'] if k in cash else row.get('cash_cents')
        options=rd_options(db,month,row['game_name'])
        rd=next((x['amount_cents'] for x in options if x['id']==row.get('rd_line_id')),None)
        checked=row.get('status')=='checked' and row.get('expected_cash_cents')==actual and row.get('expected_rd_cents')==rd and rd is not None
        row.update(cash_cents=actual,imported=k in cash,expected_cash_cents=actual,expected_rd_cents=rd,rd_cents=rd,rd_options=options,status='checked' if checked else 'pending')
        result.append(row)
    return {'month':month,'revision':doc.revision if doc else 0,'rows':result,'schema_ready':True,'write_ready':write,'reason':reason}

def save_month(db,month,payload,actor_id):
    validate_month(month)
    if not monthly_ready(db)[1]: raise HTTPException(503,'正式保存未开放：备份恢复验证或独立迁移尚未完成')
    lock(db)
    digest=hashlib.sha256(json.dumps(payload.model_dump(mode='json'),sort_keys=True,ensure_ascii=False).encode()).hexdigest()
    prior=db.get(SelfOperatedMonthSave,str(payload.request_key))
    if prior:
        if prior.digest!=digest or prior.actor_id!=actor_id or prior.month!=month: raise HTTPException(409,'保存请求标识已被其他内容使用')
        return {'revision':prior.revision,'replayed':True}
    doc=db.get(SelfOperatedMonth,month,populate_existing=True)
    if (doc.revision if doc else 0)!=payload.revision: raise HTTPException(409,'月度表已被更新，请重新读取后核对；本次未覆盖')
    cash=order_cash(db,month)
    seen=set(); names=set(); references=set(); rows=[]
    for item in payload.rows:
        row=item.model_dump(); k=key(row)
        if k in seen: raise HTTPException(422,'同一游戏不能重复录入')
        if row["game_name"] in names: raise HTTPException(422,"Duplicate game name")
        names.add(row["game_name"])
        if row["rd_line_id"] and row["rd_line_id"] in references: raise HTTPException(422,"Duplicate RD reference")
        if row["rd_line_id"]: references.add(row["rd_line_id"])
        seen.add(k)
        actual=cash[k]['cash_cents'] if k in cash else row['cash_cents']
        if k in cash and (row['cash_cents']!=actual or row['expected_cash_cents']!=actual): raise HTTPException(409,'现金订单已经变化，请刷新核对，不允许覆盖导入现金')
        options=rd_options(db,month,row['game_name'])
        rd=next((x['amount_cents'] for x in options if x['id']==row['rd_line_id']),None)
        if row['rd_line_id'] and (rd is None or rd!=row['expected_rd_cents']): raise HTTPException(409,'引用研发账单已变化或不属于本游戏账期，请重新选择')
        if row['status']=='checked' and (any(row[x] is None for x in ['cash_cents','refund_cents','fee_cents','received_cents']) or rd is None): raise HTTPException(422,'金额或研发依据尚未完整，不可标记已核对')
        row['expected_cash_cents']=actual; row['expected_rd_cents']=rd
        rows.append(row)
    if not cash.keys()<=seen: raise HTTPException(409,'不能遗漏已导入游戏，请刷新月度表')
    revision=payload.revision+1
    if doc: doc.rows=rows;doc.revision=revision
    else: db.add(SelfOperatedMonth(month=month,revision=revision,rows=rows))
    db.add(SelfOperatedMonthSave(request_key=str(payload.request_key),month=month,digest=digest,actor_id=actor_id,revision=revision,rows=rows))
    db.flush()
    return {'revision':revision,'replayed':False}
