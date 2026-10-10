import React from 'react'

const keyOf = (candidate) => `${candidate?.bill_type || ''}:${candidate?.bill_id || ''}`
const money = (value) => Number.isFinite(Number(value)) && value != null && value !== ''
  ? `¥${Number(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '未提供'

export default function BankMatchRow({ item, selectedKey, expanded, busy, canManage, onSelect, onExpand, onConfirm, onOpenBill }) {
  const candidate = item.candidates?.find(row => keyOf(row) === selectedKey) || item.candidates?.[0]
  const highReady = item.auto_ready && keyOf(candidate) === keyOf(item.candidates?.[0])
  const income = item.direction === 'collection'
  const amount = item.amount
  const hasAmounts = candidate && amount != null && candidate.outstanding_amount != null
    && Number.isFinite(Number(amount)) && Number.isFinite(Number(candidate.outstanding_amount))
  // Display-only comparison in cents; never changes the server's allocation or ranking.
  const difference = hasAmounts ? Math.round(Number(amount) * 100) - Math.round(Number(candidate.outstanding_amount) * 100) : null
  const confidence = candidate?.confidence_level || item.confidence_level
  const confidenceText = { high: '高匹配', medium: '待确认', low: '低匹配', none: '未匹配' }[confidence] || '待确认'
  return <>
    <tr className="bank-match-row">
      <td>
        <div className="bank-match-meta"><span className={`bank-center-direction is-${item.direction}`}>{income ? '收入' : item.direction === 'payment' ? '支出' : '待判定'}</span><span>{item.trade_date || '日期未提供'}</span></div>
        <strong className="bank-match-name">{item.counterparty_name || '对方单位未识别'}</strong>
        <span className="bank-match-summary">{item.summary || '无摘要'}</span>
      </td>
      <td className="is-right">
        <strong className={`bank-match-amount ${income ? 'is-income' : item.direction === 'payment' ? 'is-expense' : ''}`}>{money(amount)}</strong>
        <span className="bank-match-secondary">{item.currency || 'CNY'} · 待核销</span>
      </td>
      <td>
        {candidate ? <>
          <div className="bank-match-meta"><b>{candidate.settlement_month || '账期未填'}</b><span>{candidate.bill_type === 'rd' ? '研发账单' : '渠道账单'}</span></div>
          <button type="button" className="bank-match-bill" onClick={() => onOpenBill(candidate.bill_type, candidate.bill_id)}>{candidate.partner_name || '合作方未填'}</button>
          <span className="bank-match-summary">{candidate.game_name || '游戏未填'}</span>
          <label className="bank-match-choice">候选账单（{item.candidates.length}）
            <select aria-label={`选择账单 ${item.transaction_id}`} value={keyOf(candidate)} onChange={event => onSelect(event.target.value)}>
              {item.candidates.map(row => <option key={keyOf(row)} value={keyOf(row)}>{row.settlement_month || '账期未填'} · {row.partner_name || '合作方未填'} · 未结 {money(row.outstanding_amount)} · {row.bill_number}</option>)}
            </select>
          </label>
        </> : <span className="bank-match-secondary">暂无候选账单<br />请先核对客户与账单资料</span>}
      </td>
      <td>
        {candidate ? <>
          <div className="bank-match-outstanding">{income ? '账单未收' : '账单未付'} <strong>{money(candidate.outstanding_amount)}</strong></div>
          <strong className={`bank-match-difference ${difference === 0 ? 'is-equal' : 'is-different'}`}>{difference == null ? '差额待核实' : difference === 0 ? '金额一致' : `流水${difference > 0 ? '多' : '少'} ${money(Math.abs(difference) / 100)}`}</strong>
          <span className={`bank-center-confidence is-${confidence}`}>{confidenceText} · {Number(candidate.score || 0).toFixed(0)}分</span>
          <span className="bank-match-secondary">金额一致仍需核对单位与账期</span>
        </> : <span className="bank-center-confidence is-none">未匹配</span>}
        {item.blocked_reason ? <span className="bank-match-warning">{item.blocked_reason}</span> : null}
      </td>
      <td><div className="bank-center-row-actions bank-match-actions">
        <button type="button" aria-expanded={expanded} onClick={onExpand}>{expanded ? '收起对照' : '展开对照'}</button>
        {canManage ? <button type="button" className={highReady ? 'is-primary' : ''} disabled={!candidate || busy} onClick={onConfirm}>{busy ? '处理中…' : highReady ? '确认核销' : '人工确认'}</button> : null}
      </div></td>
    </tr>
    {expanded ? <tr className="bank-match-detail"><td colSpan={5}>
      <div className="bank-match-comparison">
        <section><h3>银行流水</h3><strong>{item.counterparty_name || '对方单位未识别'}</strong><p>{item.trade_date || '-'} · {item.currency || 'CNY'} · {money(amount)}</p><p>摘要：{item.summary || '-'}</p><small>流水号：{item.transaction_no || '-'}</small></section>
        <section><h3>所选账单</h3>{candidate ? <><strong>{candidate.partner_name || '-'}</strong><p>{candidate.settlement_month || '账期未填'} · {candidate.game_name || '游戏未填'}</p><p>应结 {money(candidate.bill_amount)} · 未结 {money(candidate.outstanding_amount)}</p><button type="button" className="bank-match-bill" onClick={() => onOpenBill(candidate.bill_type, candidate.bill_id)}>{candidate.bill_number} · 查看账单</button></> : <p>暂无候选</p>}</section>
        <section><h3>匹配依据</h3>{candidate?.reasons?.length ? <ul>{candidate.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul> : <p>暂无匹配依据，请人工核实。</p>}<p>{item.blocked_reason || '请核对单位、账期与金额后再确认。'}</p></section>
      </div>
    </td></tr> : null}
  </>
}
