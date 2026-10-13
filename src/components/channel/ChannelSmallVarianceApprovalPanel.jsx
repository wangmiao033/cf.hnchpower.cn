import React from 'react'
import './ChannelSmallVarianceApprovalPanel.css'

/** Explicit human approval; no automatic overrides or document fabrication. */
export default function ChannelSmallVarianceApprovalPanel({
  open,
  note,
  onNoteChange,
  onConfirm,
  onCancel,
  busy,
  settlementAmount
}) {
  if (!open) return null

  return (
    <section
      id="channel-small-variance-approval"
      className="channel-small-variance-panel"
      aria-label="小额合同差异人工强制核对"
    >
      <header>
        <div>
          <span className="channel-small-variance-eyebrow">管理员人工确认 · 账单金额不改变</span>
          <h2>小额差异强制核对</h2>
          <p>
            仅适用于已人工核准的合同结算差异，差异合计不得超过 ¥0.50。
            合同主体、授权期或平台账单校验异常不能强制放行。
          </p>
        </div>
        <strong>原结算金额 ¥{Number(settlementAmount || 0).toFixed(2)}</strong>
      </header>

      <label htmlFor="channel-small-variance-note">
        <span>强制核对备注（必填）</span>
        <textarea
          id="channel-small-variance-note"
          rows={3}
          value={note}
          onChange={event => onNoteChange(event.target.value)}
          maxLength={500}
          disabled={busy}
          placeholder="例如：2026年8月云上征途按双方分成确认函结算¥0.65，差异¥0.04；分成28%、通道费5%，管理员核准保留原金额。"
        />
      </label>
      <p className="channel-small-variance-explain">
        点击后只核对服务器已经保存的账单，不会修改原合同、分成比例、通道费、实际结算或回款。
        处理动作、审核人、差异金额及备注会写入操作日志。
      </p>
      <footer>
        <button type="button" disabled={busy} onClick={onCancel}>取消</button>
        <button
          type="button"
          className="is-primary"
          disabled={busy || note.trim().length < 2}
          onClick={onConfirm}
        >
          {busy ? '正在校验并写入审核日志…' : '确认强制核对（保留原金额）'}
        </button>
      </footer>
    </section>
  )
}
