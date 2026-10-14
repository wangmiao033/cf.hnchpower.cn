import React, { useState } from 'react'
import PageContainer from '@/components/layout/PageContainer.jsx'
import { useAppState } from '@/app/AppStateContext.jsx'
import {
  billStatusLabel,
  canRequestReviewedBillAmendment,
  isValidReviewedBillAmendmentNote
} from '@/domain/reconciliation/billLifecycle.js'
import { invalidateEditRecord } from '@/lib/api/editRecordCache.js'
import { transitionBillLifecycle } from '@/lib/api/billLifecycle.ts'
import './LockedBillEditNotice.css'

/**
 * Reviewed bills always show their contents. Only entering business-data editing
 * requires an explicit note. The existing audited lifecycle transition makes
 * the bill pending before the user can submit modified financial information.
 */
export default function LockedBillEditNotice({
  billType,
  record,
  onOpen360,
  onBack,
  onEditApproved,
  children
}) {
  const { recon, showToast } = useAppState()
  const [showEditNote, setShowEditNote] = useState(false)
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const billId = String(record?.id || '')
  const billName = billType === 'rd' ? '研发账单' : '渠道账单'
  const canEdit = canRequestReviewedBillAmendment(record?.status)
  const noteValid = isValidReviewedBillAmendmentNote(note)

  const enterEditWithNote = async () => {
    const normalizedNote = note.trim()
    if (!isValidReviewedBillAmendmentNote(normalizedNote)) {
      showToast('请填写修改备注，至少 2 个字', 'error')
      return
    }
    if (!billId || submitting || !canEdit) return

    setSubmitting(true)
    try {
      // The reason is required and saved by the backend lifecycle transition.
      // No business amount is changed before the user saves the edit form.
      await transitionBillLifecycle(billType, billId, 'pending', normalizedNote)
      invalidateEditRecord(billType === 'rd' ? 'rd' : 'channel', billId)
      try {
        if (billType === 'rd') {
          await recon.refetchReconciliationFromApi?.()
        } else {
          await recon.refetchChannelFromApi?.()
        }
      } catch (refreshError) {
        console.warn('账单已进入待核对编辑状态，列表刷新暂时失败', refreshError)
      }
      showToast('修改备注已记录，现可编辑账单；保存后请重新核对', 'success')
      // The editing page can refresh its authoritative record even when the
      // list-cache update has not propagated to this component yet.
      onEditApproved?.()
    } catch (error) {
      const message = error instanceof Error && error.message
        ? error.message
        : '进入账单修改失败，请稍后重试。'
      showToast(message, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <PageContainer hideHeader className={`locked-bill-edit-page has-readonly-details ${billType === 'channel' ? 'is-compact-channel' : ''}`}>
      <section className="locked-bill-edit-card">
        <span className="locked-bill-edit-mark" aria-hidden="true">单</span>
        <div>
          <span className="locked-bill-edit-eyebrow">{billName} · 历史详情可直接查看</span>
          <h1>{billType === 'channel'
            ? `${billStatusLabel(record?.status)} · ${record?.channelName || '渠道账单'} · ${record?.settlementMonth || ''}`
            : `账单详情 · ${billStatusLabel(record?.status)}`}</h1>
          <p>
            下方完整展示原始账单和结算明细，查看无需任何操作。
            {canEdit
              ? ' 如需修改，填写一条修改备注即可进入编辑；历史确认记录保留，修改完成后需要重新核对。'
              : ' 当前账单不能从此页直接修改，请通过账单列表的对应业务流程处理。'}
          </p>

          {showEditNote && canEdit ? (
            <div className="locked-bill-return-form">
              <label htmlFor={'reviewed-bill-edit-note-' + billId}>
                <span>修改备注（必填）</span>
                <textarea
                  id={'reviewed-bill-edit-note-' + billId}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="例如：修正2026年8月某游戏的分成金额，并重新核对结算依据"
                  rows={3}
                  maxLength={300}
                  disabled={submitting}
                  autoFocus
                />
              </label>
              <p className="locked-bill-note-explainer">
                确认后系统先记录修改原因并切换为“待核对”，然后打开编辑表单；
                只填写备注不会改变原账单金额。后续修改需重新确认核对。
              </p>
              <div>
                <button
                  type="button"
                  className="primary"
                  onClick={() => void enterEditWithNote()}
                  disabled={submitting || !noteValid}
                >
                  {submitting ? '正在记录备注…' : '保存备注并进入修改'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowEditNote(false)
                    setNote('')
                  }}
                  disabled={submitting}
                >
                  取消
                </button>
              </div>
            </div>
          ) : null}

          <div className="locked-bill-edit-actions">
            {canEdit && !showEditNote ? (
              <button
                type="button"
                className={billType === 'channel' ? '' : 'primary'}
                onClick={() => setShowEditNote(true)}
              >
                {billType === 'channel' ? '修改账单' : '修改账单（填写备注）'}
              </button>
            ) : null}
            {onOpen360 ? <button type="button" onClick={onOpen360}>{billType === 'channel' ? '核对记录' : '查看核对结果'}</button> : null}
            <button type="button" onClick={onBack}>返回列表</button>
          </div>
          <small>{billName} · 查看不改变账单；修改备注及状态变化写入操作日志。</small>
        </div>
      </section>
      {children ? (
        <div className="locked-bill-readonly-content">{children}</div>
      ) : (
        <p className="locked-bill-readonly-content" role="status">正在读取账单明细…</p>
      )}
    </PageContainer>
  )
}
