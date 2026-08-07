import React from 'react'
import PageContainer from '@/components/layout/PageContainer.jsx'
import { billStatusLabel } from '@/domain/reconciliation/billLifecycle.js'
import './LockedBillEditNotice.css'

export default function LockedBillEditNotice({
  billType,
  record,
  onOpen360,
  onBack
}) {
  return (
    <PageContainer hideHeader className="locked-bill-edit-page">
      <section className="locked-bill-edit-card">
        <span className="locked-bill-edit-mark">锁</span>
        <div>
          <span className="locked-bill-edit-eyebrow">账单已锁定</span>
          <h1>当前状态：{billStatusLabel(record?.status)}</h1>
          <p>
            该账单已经完成核对，金额、分成、产品、账期等业务字段不能直接修改。
            如确需调整，请先在账单 360° 的“操作日志”中执行“退回待核对/重新打开”，并填写原因。
          </p>
          <div className="locked-bill-edit-actions">
            <button type="button" className="primary" onClick={onOpen360}>打开账单 360°</button>
            <button type="button" onClick={onBack}>返回列表</button>
          </div>
          <small>{billType === 'rd' ? '研发账单' : '渠道账单'} · 所有退回与重新打开操作都会写入审计日志。</small>
        </div>
      </section>
    </PageContainer>
  )
}
