import React, { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import RdSettlementExplanation from './RdSettlementExplanation.jsx'
import './RdCalculationPopover.css'

/** Keep each R&D game row compact: calculations open on demand in a portal. */
export default function RdCalculationPopover({ line, channelFeeRate, amount, rowIndex }) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef(null)
  const closeRef = useRef(null)
  const titleId = useId()

  const close = () => {
    setOpen(false)
    triggerRef.current?.focus()
  }

  useEffect(() => {
    if (!open) return undefined
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    closeRef.current?.focus()
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  const title = `${line?.gameName || `第 ${rowIndex + 1} 行`} · 计算过程`
  const modal = (
    <div
      className="rd-calculation-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <section
        className="rd-calculation-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="rd-calculation-dialog__head">
          <div>
            <h3 id={titleId}>{title}</h3>
            <small>{line?.settlementCycle || '当前结算周期'} · 只读计算明细</small>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="rd-calculation-dialog__close"
            aria-label="关闭计算过程"
            onClick={close}
          >×</button>
        </header>
        <RdSettlementExplanation line={line} channelFeeRate={channelFeeRate} />
      </section>
    </div>
  )

  return (
    <div className="rd-calculation-amount">
      <input
        type="text"
        readOnly
        disabled
        aria-label={`第 ${rowIndex + 1} 行研发应结`}
        className="admin-input readonly-input channel-input-num"
        value={Number(amount || 0).toFixed(2)}
      />
      <button
        ref={triggerRef}
        type="button"
        className="rd-calculation-trigger"
        title="查看本行计算过程"
        aria-label={`查看${line?.gameName || `第 ${rowIndex + 1} 行`}的计算过程`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >ⓘ</button>
      {open && typeof document !== 'undefined' ? createPortal(modal, document.body) : null}
    </div>
  )
}
