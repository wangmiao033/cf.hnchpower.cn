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
  settlementAmount,
  kind = 'contract',
  platformReview = null
}) {
  if (!open) return null
  const isPlatform = kind === 'platform'
  const amount = Number(platformReview?.settlementAmount ?? settlementAmount ?? 0)

  return (
    <section
      id="channel-small-variance-approval"
      className="channel-small-variance-panel"
      aria-label={isPlatform ? '平台结算尾差人工核对' : '小额合同差异人工核对'}
    >
      <header>
        <div>
          <span className="channel-small-variance-eyebrow">管理员人工确认 · 账单金额不改变</span>
          <h2>{isPlatform ? '平台账单小额尾差确认' : '小额合同差异强制核对'}</h2>
          {isPlatform ? (
            <p>系统与平台存在不超过 ¥0.50 的差额。请核对实际渠道账单并记录依据；合同身份、授权及其他未处理差异仍须通过正常校验。</p>
          ) : (
            <p>仅适用于已人工核准的合同结算差异，差异合计不得超过 ¥0.50；合同主体、授权期或平台账单校验异常不能强制放行。</p>
          )}
        </div>
        <strong>原结算金额 ¥{amount.toFixed(2)}</strong>
      </header>

      {isPlatform && platformReview ? (
        <div className="channel-small-variance-explain" role="status">
          <strong>系统计算 ¥{platformReview.systemAmount.toFixed(2)}　→　平台账单 ¥{platformReview.platformAmount.toFixed(2)}</strong>
          <span>系统－平台：{(platformReview.differenceCents / 100).toFixed(2)} 元。只记录人工核准，不调整实际应收。</span>
        </div>
      ) : null}

      <label htmlFor="channel-small-variance-note">
        <span>{isPlatform ? '平台金额核对依据（至少6字）' : '强制核对备注（必填）'}</span>
        <textarea
          id="channel-small-variance-note"
          rows={3}
          value={note}
          onChange={event => onNoteChange(event.target.value)}
          maxLength={500}
          disabled={busy}
          placeholder={isPlatform
            ? '例如：已核对本期渠道结算单，平台金额与系统金额相差¥0.21，确认以平台实际结算金额为准；保留原规则和差异记录。'
            : '例如：2026年8月云上征途按双方分成确认函结算¥0.65，差异¥0.04；分成28%、通道费5%，管理员核准保留原金额。'}
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
          disabled={busy || note.trim().length < (isPlatform ? 6 : 2)}
          onClick={onConfirm}
        >
          {busy ? '正在校验并写入审核日志…' : isPlatform ? '核准平台尾差并完成核对' : '确认强制核对（保留原金额）'}
        </button>
      </footer>
    </section>
  )
}
