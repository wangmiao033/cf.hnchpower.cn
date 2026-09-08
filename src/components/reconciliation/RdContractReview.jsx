import React from 'react'
import { buildRdContractReview } from '@/domain/reconciliation/rdContractReview.js'
import RdSettlementExplanation, { rdMoney } from './RdSettlementExplanation.jsx'

export default function RdContractReview({ record, recommendation, current, loading, error, snapshotInfo, onApply, mode, deviationMap, overrideReasons, onOverrideChange }) {
  const review = buildRdContractReview(record, recommendation, { current, loading, error })
  const status = loading ? '正在匹配合同' : error ? '合同服务暂不可用' : !current && recommendation ? '匹配结果待刷新' : review.pendingCount ? `${review.pendingCount} 项需核对` : review.comparable ? '合同口径明确' : '等待合作方和游戏'
  return (
    <section className="rd-contract-review" aria-label="合同智能核对">
      <header className="rd-review-head"><div><h2>合同核对</h2><span className={review.comparable ? 'rd-review-pass' : 'rd-review-pending'}>{status}</span></div><p>先确认结算口径，再比较应结金额</p></header>
      {error ? <p role="status" className="rd-review-notice">{error}。可先保存为待核对账单，确认核对前会再次核验。</p> : null}
      {!current && recommendation && !loading ? <p className="rd-review-notice">合作方、游戏或账期已变化，等待重新匹配；旧试算暂不参与比较。</p> : null}
      {recommendation?.header_recommendation?.message ? <p className="rd-review-notice">{recommendation.header_recommendation.message}</p> : null}
      <div className="rd-review-lines">
        {review.lines.map((entry) => {
          const { line, item, index } = entry
          const rec = item?.recommended
          const deviations = deviationMap?.[index] || []
          return (
            <article className="rd-review-line" key={`${index}-${line.id || line.gameName}`}>
              <div className="rd-review-line-head"><strong title={line.gameName}>{line.gameName}</strong><span>{line.settlementCycle || record?.settlementMonth}</span><b className={entry.comparable ? 'rd-review-pass' : 'rd-review-pending'}>{entry.comparable ? Math.abs(entry.difference) <= 0.01 ? '金额一致' : '存在金额差异' : '待人工核对'}</b></div>
              <p className="rd-review-contract-name" title={item?.match?.contract_name}>{item?.match?.contract_name || '尚未匹配到适用合同'}</p>
              {!entry.comparable ? <p className="rd-review-notice">{entry.reasons.join('；')}。暂不认定为人工调整。</p> : null}
              {entry.comparisons.length ? <div className="rd-review-differences">{entry.comparisons.map((field) => <span key={field.key}><b>{field.label}</b>：账单 {field.actual}{field.unit} / 合同{entry.comparable ? '' : '参考'} {field.recommended}{field.unit}</span>)}</div> : null}
              {entry.comparable && Math.abs(entry.difference) > 0.01 && !entry.comparisons.length ? <p className="rd-review-notice">字段未发现直接差异，请核对流水、代金券、额外费用及合同计算依据。</p> : null}
              <details className="rd-review-evidence">
                <summary>查看合同依据与计算过程</summary>
                <dl>
                  <div><dt>合同编号</dt><dd>{item?.match?.contract_no || '未提供'}</dd></div>
                  <div><dt>匹配与授权</dt><dd>{item?.score != null ? `匹配 ${item.score} 分 · ` : ''}{item?.match?.authorization_status === 'covered' ? '授权期内' : item?.match?.authorization_status === 'out_of_range' ? '授权期外' : '待确认'}</dd></div>
                  <div><dt>合同结算口径</dt><dd>{rec?.basis_mode === 'actual_paid' ? '按实付 / 实收' : rec?.basis_mode === 'discounted_flow' ? '按折后流水' : '待确认'}</dd></div>
                  <div><dt>{entry.comparable ? '合同应结' : '参考试算（未确认）'}</dt><dd>{rdMoney(entry.expected)}</dd></div>
                  <div><dt>合同分成</dt><dd>{rec?.share_ratio == null ? '待确认' : `${rec.share_ratio}%`}</dd></div>
                  <div><dt>合同税率 / 通道费 / 测试费</dt><dd>{rec?.tax_rate == null ? '未明确' : `${rec.tax_rate}%`} / {rec?.channel_fee_rate == null ? '未明确' : `${rec.channel_fee_rate}%`} / {rdMoney(rec?.test_fee)}</dd></div>
                </dl>
                {rec?.settlement_basis ? <p>合同结算依据：{rec.settlement_basis}</p> : null}
                {rec?.discount_policy === 'reference_only' ? <p>产品折扣仅作业务参考，合同按实付 / 实收结算。</p> : null}
                {[...(rec?.warnings || []), ...(item?.contract_amount?.assumptions || [])].map((note, i) => <p className="rd-review-notice" key={i}>{note}</p>)}
                <h3>当前账单如何计算</h3>
                <RdSettlementExplanation line={line} channelFeeRate={record?.channelFeeRate} />
              </details>
              {deviations.length ? <label className="rd-review-override">与合同字段不同：{deviations.join('、')}<input value={overrideReasons?.[index] || ''} onChange={(event) => onOverrideChange(index, event.target.value)} placeholder="填写调整原因，随账单保留" /></label> : null}
            </article>
          )
        })}
      </div>
      {recommendation ? <footer className="rd-review-summary">
        <div><span>当前账单应结</span><strong>{rdMoney(review.actual)}</strong></div>
        <div><span>合同应结</span><strong>{review.comparable ? rdMoney(review.expected) : '待确认'}</strong></div>
        <div><span>账单与合同差额</span><strong>{review.difference == null ? '暂不比较' : Math.abs(review.difference) <= 0.01 ? '一致' : `${review.difference > 0 ? '+' : ''}${rdMoney(review.difference)}`}</strong></div>
        <button type="button" onClick={onApply} disabled={loading || Boolean(error) || !current || recommendation.header_recommendation?.compatible === false || !recommendation.lines?.some((item) => item.auto_apply)}>{mode === 'edit' ? '带入已明确的合同字段' : '重新带入已明确字段'}</button>
        {snapshotInfo?.created_at ? <small>合同快照：{String(snapshotInfo.created_at).replace('T', ' ').slice(0, 19)}</small> : null}
      </footer> : null}
    </section>
  )
}
