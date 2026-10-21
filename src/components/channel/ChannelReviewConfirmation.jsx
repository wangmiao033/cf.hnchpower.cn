import React, { useEffect, useId, useRef } from 'react'
import './ChannelReviewConfirmation.css'

/** A normal in-app confirmation, not a financial approval or variance override. */
export default function ChannelReviewConfirmation({ request, onCancel, onConfirm }) {
  const dialogRef = useRef(null)
  const cancelRef = useRef(null)
  const submittedRef = useRef(false)
  const titleId = useId()
  const descriptionId = useId()
  useEffect(() => {
    if (!request) return
    submittedRef.current = false
    const previous = document.activeElement
    const dialog = dialogRef.current
    dialog.showModal()
    cancelRef.current?.focus()
    return () => {
      dialog.close()
      if (previous?.isConnected) previous.focus()
    }
  }, [request])
  if (!request) return null
  return (
    <dialog ref={dialogRef} className="channel-review-confirmation" aria-labelledby={titleId}
      aria-describedby={descriptionId} onKeyDown={event => {
        if (event.key !== 'Tab') return
        const buttons = [...dialogRef.current.querySelectorAll('button:not([disabled])')]
        const first = buttons[0]
        const last = buttons[buttons.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last?.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first?.focus()
        }
      }} onCancel={event => { event.preventDefault(); onCancel() }}>
      <h2 id={titleId}>{request.zeroSettlement ? '确认核对并结清' : '确认本张渠道账单'}</h2>
      <dl>
        <div><dt>合作方</dt><dd>{request.partnerName || '—'}</dd></div>
        <div><dt>账单月份</dt><dd>{request.month || '—'}</dd></div>
        <div><dt>结算金额</dt><dd className="channel-review-confirmation__amount">{request.amountLabel}</dd></div>
      </dl>
      <p id={descriptionId}>{request.dirty ? '先保存当前修改，再校验并确认核对。' : '当前无未保存修改，将校验服务器账单并确认核对。'}
        {request.zeroSettlement ? '本期无需开票和收款，确认后账单将直接完成并锁定。' : '核对成功后账单将锁定；累计结算合作方将进入累计池，不会立即催收或开票。'}</p>
      <p>如发现合同或平台金额差异，将停留在当前页处理，不会自动放行。</p>
      <div className="channel-review-confirmation__actions">
        <button ref={cancelRef} type="button" onClick={onCancel}>返回检查</button>
        <button type="button" className="primary" onClick={() => {
          if (submittedRef.current) return
          submittedRef.current = true
          onConfirm(request)
        }}>{request.dirty ? '保存并开始核对' : '开始核对'}</button>
      </div>
    </dialog>
  )
}
