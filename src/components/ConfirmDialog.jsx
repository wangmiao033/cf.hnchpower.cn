import React, { useEffect, useId, useRef } from 'react'
import './ConfirmDialog.css'

function ConfirmDialog({
  isOpen,
  title,
  message,
  onConfirm,
  onCancel,
  confirmText = '确认',
  cancelText = '取消',
  busy = false
}) {
  const titleId = useId()
  const cancelRef = useRef(null)

  useEffect(() => {
    if (!isOpen) return undefined
    const previous = document.activeElement
    const focusTimer = window.setTimeout(() => cancelRef.current?.focus(), 0)
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !busy) {
        event.preventDefault()
        onCancel?.()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.clearTimeout(focusTimer)
      document.removeEventListener('keydown', onKeyDown)
      if (previous instanceof HTMLElement) previous.focus?.()
    }
  }, [isOpen, busy, onCancel])

  if (!isOpen) return null
  const isReactElement = React.isValidElement(message)

  return (
    <div className="confirm-dialog-overlay" onMouseDown={() => { if (!busy) onCancel?.() }}>
      <div
        className={`confirm-dialog ${isReactElement ? 'large' : ''}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={busy || undefined}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h3 id={titleId}>{title}</h3>
        {isReactElement ? <div className="dialog-message">{message}</div> : <p>{message}</p>}
        <div className="dialog-buttons">
          <button ref={cancelRef} type="button" className="cancel-btn" disabled={busy} onClick={onCancel}>{cancelText}</button>
          <button type="button" className="confirm-btn" disabled={busy} onClick={onConfirm}>{busy ? '处理中…' : confirmText}</button>
        </div>
      </div>
    </div>
  )
}

export default ConfirmDialog
