import React from 'react'
import { scannedInvoiceAmountState } from '@/domain/channel/channelInvoiceUploadMatch.js'

const money = cents => '¥' + (Number(cents || 0) / 100).toLocaleString('zh-CN', { minimumFractionDigits:2, maximumFractionDigits:2 })

/** Show the exact pending invoice amount and bill selection. Choosing candidates
 * is never a tax-invoice creation or ledger mutation.
 */
export default function ChannelInvoiceBillSuggestions({
  gross = 0, selectedTotalCents = 0, candidates = [],
  selectedIds = [], recommendedIds = [], ambiguous = false,
  loading = false, onToggle, onApplyRecommendation
}) {
  const state = scannedInvoiceAmountState(gross, selectedTotalCents)
  const selected = new Set(selectedIds.map(String))
  return (
    <section className="channel-invoice-smart-bills" aria-label="智能匹配发票与账单">
      <div className={'channel-invoice-smart-bills__compare is-' + state.kind}>
        <div><span>原始发票价税合计</span><strong>{money(Math.round(Number(gross || 0)*100))}</strong></div>
        <div><span>已选账单未开票金额</span><strong>{money(selectedTotalCents)}</strong></div>
        <div><span>差额</span><strong>{money(Math.abs(state.delta))}</strong></div>
      </div>
      <p className={'channel-invoice-smart-bills__hint is-' + state.kind}>
        {state.kind === 'match' ? '✓ 金额完全匹配，可以在核对票号与主体后关联。' : state.message}
      </p>
      {loading ? <p className="channel-invoice-smart-bills__hint">正在查询同一合作方的其他月份账单及剩余开票金额…</p> : null}
      {!loading && state.kind === 'mismatch' && recommendedIds.length > 0 ? (
        <button type="button" className="channel-invoice-smart-bills__recommend" onClick={onApplyRecommendation}>
          发现唯一金额匹配组合 · 加入 {recommendedIds.length} 张相关月份账单
        </button>
      ) : null}
      {ambiguous ? (
        <p className="channel-invoice-smart-bills__hint">有多种金额组合都能匹配，请人工核对账期后选择，系统不会随意关联。</p>
      ) : null}
      {candidates.length ? (
        <details className="channel-invoice-smart-bills__candidates" open={state.kind !== 'match' ? true : undefined}>
          <summary>同一合作方的其他可开票账单（{candidates.length} 张）</summary>
          <div className="channel-invoice-smart-bills__list">
            {candidates.map(item => (
              <label key={item.id}>
                <input type="checkbox" checked={selected.has(String(item.id))}
                  onChange={event => onToggle?.(String(item.id),event.target.checked)} />
                <span>{item.settlementMonth || '账期未知'} · {item.statementNo || item.billNumber || item.id}</span>
                <strong>{money(item.remainingCents)}</strong>
              </label>
            ))}
          </div>
          <small>只会检索同一合作方、已核对并且尚有未开票余额的账单。需由你确认后才会登记关联。</small>
        </details>
      ) : null}
    </section>
  )
}
