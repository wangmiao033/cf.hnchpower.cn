import React from 'react'
import BillScanAttachments from '@/components/billing/BillScanAttachments.jsx'
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
  platformReview = null,
  billId = '',
  attachments = [],
  selectedAttachmentId = '',
  onAttachmentChange,
  onAttachmentsChanged,
  acknowledgedSource = false,
  onAcknowledgedSourceChange
}) {
  if (!open) return null
  const isPlatform = kind === 'platform'
  const isDocumented = isPlatform && platformReview?.reviewKind === 'documented'
  const amount = Number(platformReview?.settlementAmount ?? settlementAmount ?? 0)

  return (
    <section
      id="channel-small-variance-approval"
      className="channel-small-variance-panel"
      aria-label={isPlatform ? (isDocumented ? '平台结算金额差异凭证审核' : '平台小额尾差核对') : '小额合同差异人工核对'}
    >
      <header>
        <div>
          <span className="channel-small-variance-eyebrow">管理员人工确认 · 账单金额不改变</span>
          <h2>{isDocumented ? '平台结算金额差异确认' : isPlatform ? '平台小额尾差确认' : '小额合同差异强制核对'}</h2>
          {isPlatform ? (
            <p>{isDocumented
              ? '超过 ¥0.50 的金额差异必须上传平台原始结算单，管理员核实分成及金额后填写原因；确认只改变账单核对状态，不修改金额，也不等于已经收到款。'
              : '系统与平台存在不超过 ¥0.50 的尾差。请核对实际渠道账单并记录依据；合同身份、授权及其他未处理差异仍须通过正常校验。'}</p>
          ) : (
            <p>仅适用于已人工核准的合同结算差异，差异合计不得超过 ¥0.50；合同主体、授权期或平台账单校验异常不能强制放行。</p>
          )}
        </div>
        <strong>原结算金额 ¥{amount.toFixed(2)}</strong>
      </header>

      {isPlatform && platformReview ? (
        <div className="channel-small-variance-explain" role="status">
          <strong>系统计算 ¥{platformReview.systemAmount.toFixed(2)}　→　平台账单 ¥{platformReview.platformAmount.toFixed(2)}</strong>
          <span>系统－平台：{(platformReview.differenceCents / 100).toFixed(2)} 元；逐游戏差异绝对值合计 ¥{(Number(platformReview.absoluteLineDifferenceCents || Math.abs(platformReview.differenceCents)) / 100).toFixed(2)}。只记录人工核准，不调整实际应收。</span>
        </div>
      ) : null}

      <label htmlFor="channel-small-variance-note">
        <span>{isDocumented ? '原始平台结算单核对原因（至少12字）' : isPlatform ? '平台金额核对依据（至少6字）' : '强制核对备注（必填）'}</span>
        <textarea
          id="channel-small-variance-note"
          rows={3}
          value={note}
          onChange={event => onNoteChange(event.target.value)}
          maxLength={500}
          disabled={busy}
          placeholder={isPlatform
            ? isDocumented
              ? '例如：已逐游戏核对小米开发者平台2026年9月的分成明细及原始结算凭证，本期按平台实结金额确认，原规则与计算差异保留待分析。'
              : '例如：已核对本期渠道结算单，平台金额与系统金额相差¥0.21，确认以平台实际结算金额为准；保留原规则和差异记录。'
            : '例如：2026年8月云上征途按双方分成确认函结算¥0.65，差异¥0.04；分成28%、通道费5%，管理员核准保留原金额。'}
        />
      </label>
      {isDocumented ? (
        <div className="channel-platform-evidence">
          <strong>1. 上传原始结算凭证（必需）</strong>
          <BillScanAttachments billType="channel" billId={billId} onChanged={onAttachmentsChanged} />
          <label htmlFor="channel-platform-variance-evidence">
            <span>2. 选择本次审批依据的文件</span>
            <select
              id="channel-platform-variance-evidence"
              value={selectedAttachmentId}
              onChange={event => onAttachmentChange?.(event.target.value)}
              disabled={busy}
            >
              <option value="">请选择已上传的平台结算单</option>
              {attachments.map(item => (
                <option key={item.id} value={item.id}>{item.file_name}</option>
              ))}
            </select>
          </label>
          <label className="channel-platform-evidence__check">
            <input
              type="checkbox"
              checked={acknowledgedSource}
              onChange={event => onAcknowledgedSourceChange?.(event.target.checked)}
              disabled={busy}
            />
            <span>3. 我已核对小米（或对应平台）的原始分成明细，确认按平台实际结算金额入账；原始规则及差额保留以供追溯。</span>
          </label>
          <small>结算门槛请在本页的「累计结算策略」中单独设置；确认账单不会直接产生收款或发票。</small>
        </div>
      ) : null}
      <p className="channel-small-variance-explain">
        点击后只核对服务器已经保存的账单，不会修改原合同、分成比例、通道费、实际结算或回款。
        处理动作、审核人、差异金额及备注会写入操作日志。
      </p>
      <footer>
        <button type="button" disabled={busy} onClick={onCancel}>取消</button>
        <button
          type="button"
          className="is-primary"
          disabled={busy || note.trim().length < (isDocumented ? 12 : isPlatform ? 6 : 2) || (isDocumented && (!selectedAttachmentId || !acknowledgedSource))}
          onClick={onConfirm}
        >
          {busy ? '正在校验并写入审核日志…' : isDocumented ? '核准平台实结金额并完成核对' : isPlatform ? '核准平台尾差并完成核对' : '确认强制核对（保留原金额）'}
        </button>
      </footer>
    </section>
  )
}
