import React from 'react'

const ICONS = {
  contract: '合',
  bill: '账',
  invoice: '票',
  funding: '银'
}

export default function BillClosureRail({ closure, onStage }) {
  if (!closure?.stages?.length) return null
  return (
    <section className="bill360-closure-shell" aria-label="账单闭环状态">
      <div className="bill360-closure-head">
        <div>
          <span>V4.0 · CLOSED LOOP</span>
          <strong>合同 → 账单 → 发票 → 资金</strong>
        </div>
        <em className={`is-${closure.state}`}>{closure.label} · {closure.completed}/{closure.total}</em>
      </div>
      <div className="bill360-closure-rail">
        {closure.stages.map((stage) => (
          <button
            type="button"
            key={stage.key}
            className={`bill360-closure-step is-${stage.tone}`}
            onClick={() => onStage?.(stage.key)}
            title={stage.detail}
          >
            <i aria-hidden>{ICONS[stage.key] || '·'}</i>
            <strong>{stage.label} · {stage.title}</strong>
            <small>{stage.detail}</small>
          </button>
        ))}
      </div>
    </section>
  )
}
