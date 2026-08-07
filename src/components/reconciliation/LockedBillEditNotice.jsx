import React, { useState } from 'react'
import PageContainer from '@/components/layout/PageContainer.jsx'
import { useAppState } from '@/app/AppStateContext.jsx'
import { billStatusLabel } from '@/domain/reconciliation/billLifecycle.js'
import { invalidateEditRecord } from '@/lib/api/editRecordCache.js'
import { transitionBillLifecycle } from '@/lib/api/billLifecycle.ts'
import './LockedBillEditNotice.css'

export default function LockedBillEditNotice({
  billType,
  record,
  onOpen360,
  onBack
}) {
  const { recon, showToast } = useAppState()
  const [showReturnForm, setShowReturnForm] = useState(false)
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const billId = String(record?.id || '')
  const billName = billType === 'rd' ? '研发账单' : '渠道账单'

  const returnToPending = async () => {
    const normalizedReason = reason.trim()
    if (normalizedReason.length < 2) {
      showToast('请填写退回原因，至少 2 个字', 'error')
      return
    }
    if (!billId || submitting) return

    setSubmitting(true)
    try {
      await transitionBillLifecycle(billType, billId, 'pending', normalizedReason)
      invalidateEditRecord(billType === 'rd' ? 'rd' : 'channel', billId)
      if (billType === 'rd') {
        await recon.refetchReconciliationFromApi?.()
      } else {
        await recon.refetchChannelFromApi?.()
      }
      showToast('已退回“待核对”，现在可以继续修改账单', 'success')
    } catch (error) {
      const message = error instanceof Error && error.message
        ? error.message
        : '退回待核对失败，请稍后重试。'
      showToast(message, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <PageContainer hideHeader className="locked-bill-edit-page">
      <section className="locked-bill-edit-card">
        <span className="locked-bill-edit-mark">锁</span>
        <div>
          <span className="locked-bill-edit-eyebrow">账单已核对并锁定</span>
          <h1>当前状态：{billStatusLabel(record?.status)}</h1>
          <p>
            该账单已经完成核对，金额、分成、产品、账期等业务字段不能直接修改。
            如确需调整，请先退回“待核对”，填写原因后系统会解锁业务字段，并把本次退回写入操作日志。
          </p>

          {showReturnForm ? (
            <div className="locked-bill-return-form">
              <label htmlFor={`locked-bill-return-reason-${billId}`}>
                <span>退回原因</span>
                <textarea
                  id={`locked-bill-return-reason-${billId}`}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="例如：补充 5 月结算周期，需重新核对"
                  rows={3}
                  maxLength={300}
                  disabled={submitting}
                  autoFocus
                />
              </label>
              <div>
                <button
                  type="button"
                  className="danger"
                  onClick={() => void returnToPending()}
                  disabled={submitting || reason.trim().length < 2}
                >
                  {submitting ? '正在退回…' : '确认退回待核对'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowReturnForm(false)
                    setReason('')
                  }}
                  disabled={submitting}
                >
                  取消
                </button>
              </div>
            </div>
          ) : null}

          <div className="locked-bill-edit-actions">
            {!showReturnForm ? (
              <button type="button" className="primary" onClick={() => setShowReturnForm(true)}>
                退回待核对后修改
              </button>
            ) : null}
            <button type="button" onClick={onOpen360}>打开账单 360°</button>
            <button type="button" onClick={onBack}>返回列表</button>
          </div>
          <small>{billName} · 退回、重新打开以及后续再次核对都会保留审计记录。</small>
        </div>
      </section>
    </PageContainer>
  )
}
