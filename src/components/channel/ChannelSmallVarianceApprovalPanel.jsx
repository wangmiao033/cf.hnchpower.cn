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
  attachmentsLoading = false
}) {
  if (!open) return null
  const isPlatform = kind === 'platform'
  const isDocumented = isPlatform && platformReview?.reviewKind === 'documented'
  const autoSelectedAttachmentId = selectedAttachmentId || (attachments.length === 1 ? attachments[0].id : '')
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
              ? '请核对已上传的平台原始账单。点击下方确认即可完成核对，系统自动保存差异金额、凭证及审核人；无需再填写重复原因。'
              : '核对后点击确认即可；系统会自动生成金额差异说明并记录审批人，原计算和实际收款均不改变。'}</p>
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

      {isPlatform ? (
        <details className="channel-platform-optional-note">
          <summary>补充说明（选填，系统已自动生成核对记录）</summary>
          <label htmlFor="channel-small-variance-note">
            <span>其他情况补充</span>
            <textarea
              id="channel-small-variance-note"
              rows={2}
              value={note}
              onChange={event => onNoteChange(event.target.value)}
              maxLength={250}
              disabled={busy}
              placeholder="如需补充具体原因可在此填写；不填写也能确认。"
            />
          </label>
        </details>
      ) : (
      <label htmlFor="channel-small-variance-note">
        <span>合同差异处理原因（必填）</span>
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
      )}
      {isDocumented ? (
        <div className="channel-platform-evidence">
          <strong>平台结算凭证</strong>
          {attachmentsLoading ? (
            <p className="channel-platform-evidence__status">正在核对已上传的凭证…</p>
          ) : attachments.length === 1 ? (
            <div className="channel-platform-evidence__linked" role="status">
              <span>已自动关联</span>
              <strong>{attachments[0].file_name}</strong>
            </div>
          ) : attachments.length > 1 ? (
            <label htmlFor="channel-platform-variance-evidence">
              <span>本单有 {attachments.length} 份附件，请选择作为本次确认依据的原始结算单</span>
              <select
                id="channel-platform-variance-evidence"
                value={selectedAttachmentId}
                onChange={event => onAttachmentChange?.(event.target.value)}
                disabled={busy}
              >
                <option value="">选择本次核对的原始凭证</option>
                {attachments.map(item => (
                  <option key={item.id} value={item.id}>{item.file_name}</option>
                ))}
              </select>
            </label>
          ) : (
            <BillScanAttachments billType="channel" billId={billId} onChanged={onAttachmentsChanged} />
          )}
          {attachments.length > 0 ? (
            <details className="channel-platform-optional-note">
              <summary>补充或更换凭证（可选）</summary>
              <BillScanAttachments billType="channel" billId={billId} onChanged={onAttachmentsChanged} />
            </details>
          ) : null}
          <p className="channel-platform-evidence__affirm">
            点击「确认」即表示管理员已核对所选原始凭证，同意按平台实际结算金额确认账单；
            系统自动留存原因、附件和操作日志，不修改原合同或实际收款。
          </p>
          {!attachmentsLoading && !autoSelectedAttachmentId ? (
            <p className="channel-platform-evidence__warning" role="status">请先上传或选择一份本单的原始结算凭证。</p>
          ) : null}
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
          disabled={busy || (!isPlatform && note.trim().length < 2) || (isDocumented && !autoSelectedAttachmentId)}
          onClick={onConfirm}
        >
          {busy ? '正在核对并保存…' : isDocumented ? `我已核对凭证，按平台¥${amount.toFixed(2)}确认账单` : isPlatform ? `按平台¥${amount.toFixed(2)}确认账单` : '确认合同差异（保留原金额）'}
        </button>
      </footer>
    </section>
  )
}
