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
      showToast('已退回修改，现在可以继续编辑账单', 'success')
    } catch (error) {
      const message = error instanceof Error && error.message
        ? error.message
        : '退回修改失败，请稍后重试。'
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
            这张账单已经核对，金额、分成、产品和账期等业务字段已锁定。
            如果发现需要调整，点“退回修改”并填写原因即可，不需要理解其他状态流转。
          </p>

          {showReturnForm ? (
            <div className="locked-bill-return-form">
              <label htmlFor={`locked-bill-return-reason-${billId}`}>
                <span>为什么要退回修改？</span>
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
                  {submitting ? '正在退回…' : '确认退回修改'}
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
                退回修改
              </button>
            ) : null}
            <button type="button" onClick={onOpen360}>查看核对结果</button>
            <button type="button" onClick={onBack}>返回列表</button>
          </div>
          <small>{billName} · 退回原因和再次核对都会自动写入操作日志。</small>
        </div>
      </section>
    </PageContainer>
  )
}
