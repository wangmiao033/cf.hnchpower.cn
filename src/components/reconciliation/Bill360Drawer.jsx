import React, { useEffect, useMemo, useState } from 'react'
import Bill360DrawerBase from './Bill360DrawerBase.jsx'
import BillContractCheckPanelV2 from './BillContractCheckPanelV2.jsx'
import Bill360FundingPanel from './Bill360FundingPanel.jsx'
import ChannelCumulativeSettlementCard from '@/components/channel/ChannelCumulativeSettlementCard.jsx'
import { getContractBillReconciliation } from '@/lib/api/contractTerms.ts'
import { getChannelCumulativeBillCondition } from '@/lib/api/channelCumulativeSettlement.ts'
import { billDueInfo, dueStatusText } from '@/domain/reconciliation/billDueDate.js'
import './Bill360ContractAware.css'
import './Bill360FundingPanel.css'
import './Bill360AnomalyPriority.css'
import './Bill360ContractAmount.css'

function money(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '-'
  return `¥${number.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function launcherText(summary, loading, unavailable) {
  if (loading) return '正在核验合同…'
  if (unavailable) return '合同核验不可用'
  if (!summary) return '合同自动核验'
  if (summary.fail_count) return `合同核验：${summary.fail_count} 条差异`
  if (summary.issue_count) return `合同核验：${summary.issue_count} 项需复核`
  if (summary.binding_count) return `合同核验：${summary.binding_count} 条已锁定`
  return `合同核验：${summary.total_lines} 条通过`
}

function amountVarianceText(amountSummary) {
  if (!amountSummary || amountSummary.expected_amount == null || amountSummary.actual_amount == null) return ''
  const variance = Number(amountSummary.variance_abs || 0)
  if (amountSummary.variance_direction === 'under') return `少结 ${money(variance)}`
  if (amountSummary.variance_direction === 'over') return `多结 ${money(variance)}`
  return '金额一致'
}

function amountStatusText(amountSummary) {
  if (!amountSummary) return '等待合同重算'
  if (amountSummary.status === 'fail') return '存在明确金额差异'
  if (amountSummary.deterministic_complete) return '合同金额重算通过'
  if (amountSummary.comparable_lines) return `已重算 ${amountSummary.comparable_lines}/${amountSummary.total_lines} 条`
  return '暂无可自动重算明细'
}

function remainingFromInitial(billType, record) {
  if (!record) return null
  if (billType === 'rd') {
    const stored = Number(record.unpaidAmount)
    if (Number.isFinite(stored)) return Math.max(0, stored)
    const amount = Number(record.settlementAmount)
    const paid = Number(record.paidAmount || 0)
    return Number.isFinite(amount) ? Math.max(0, amount - paid) : null
  }
  const amount = Number(record.settlementAmount)
  const received = Number(record.receivedAmount || 0)
  return Number.isFinite(amount) ? Math.max(0, amount - received) : null
}

function cumulativeFundingText(condition) {
  if (!condition || condition.mode !== 'threshold') return null
  if (condition.deferred) {
    const pool = condition.pool || {}
    const threshold = Number(condition.policy?.threshold_amount || 0)
    return {
      icon: '累',
      title: condition.state === 'ready' ? '累计结算 · 已达门槛' : '累计结算 · 累计中',
      detail: condition.state === 'ready'
        ? `累计 ${money(pool.basis_total)} · 可生成结算批次 · 应收 ${money(pool.settlement_total)}`
        : `累计 ${money(pool.basis_total)} / ${money(threshold)} · 还差 ${money(pool.remaining_to_threshold)}`
    }
  }
  if (condition.state === 'batched' && condition.batch) {
    return {
      icon: '批',
      title: `累计批次 · ${condition.batch.batch_no}`,
      detail: `应收 ${money(condition.batch.settlement_total)} · 已收 ${money(condition.batch.received_total)} · ${condition.batch.status}`
    }
  }
  return null
}

function Bill360Drawer({ target, onClose }) {
  const [checkOpen, setCheckOpen] = useState(false)
  const [fundingOpen, setFundingOpen] = useState(false)
  const [checkData, setCheckData] = useState(null)
  const [checkSummary, setCheckSummary] = useState(null)
  const [checkLoading, setCheckLoading] = useState(false)
  const [checkUnavailable, setCheckUnavailable] = useState(false)
  const [cumulativeCondition, setCumulativeCondition] = useState(null)
  const billType = target?.billType === 'channel' ? 'channel' : 'rd'
  const billId = String(target?.billId || '')

  useEffect(() => {
    if (!billId) return undefined
    let active = true
    setCheckLoading(true)
    setCheckUnavailable(false)
    setCheckData(null)
    setCheckSummary(null)
    void getContractBillReconciliation(billType, billId)
      .then((result) => {
        if (!active) return
        setCheckData(result)
        setCheckSummary(result.summary || null)
      })
      .catch(() => {
        if (active) setCheckUnavailable(true)
      })
      .finally(() => {
        if (active) setCheckLoading(false)
      })
    return () => { active = false }
  }, [billId, billType])

  useEffect(() => {
    if (billType !== 'channel' || !billId) {
      setCumulativeCondition(null)
      return undefined
    }
    let active = true
    void getChannelCumulativeBillCondition(billId)
      .then((result) => {
        if (active) setCumulativeCondition(result)
      })
      .catch(() => {
        if (active) setCumulativeCondition(null)
      })
    return () => { active = false }
  }, [billId, billType])

  useEffect(() => {
    setCheckOpen(false)
    setFundingOpen(false)
  }, [billId, billType])

  const cumulativeDeferred = Boolean(cumulativeCondition?.deferred)
  const cumulativeFunding = cumulativeFundingText(cumulativeCondition)
  const rawDueInfo = useMemo(() => billDueInfo(checkData), [checkData])
  const dueInfo = cumulativeDeferred ? null : rawDueInfo
  const amountSummary = checkData?.amount_summary || null
  const remainingAmount = remainingFromInitial(billType, target?.initialRecord)
  const remainingKnown = remainingAmount !== null
  const settled = remainingKnown && remainingAmount <= 0.01
  const dueText = dueStatusText(dueInfo, { settled, remainingKnown })
  const dueTone = dueInfo?.isPastDue && !settled
    ? 'is-overdue'
    : dueInfo && dueInfo.daysUntil <= 7 && !settled
      ? 'is-soon'
      : ''

  const tone = checkSummary?.fail_count
    ? 'fail'
    : checkSummary?.issue_count
      ? 'warning'
      : checkSummary
        ? 'pass'
        : 'neutral'

  return (
    <>
      <Bill360DrawerBase target={target} onClose={onClose} />

      <button
        type="button"
        className={`bill360-funding-launcher ${cumulativeFunding ? 'is-cumulative' : ''}`.trim()}
        onClick={() => setFundingOpen(true)}
        title={cumulativeDeferred ? '查看累计结算进度；未达到门槛前不进入银行收款核销' : '查看银行流水、核销分配、累计已收/已付与剩余未结'}
      >
        <span aria-hidden>{cumulativeFunding?.icon || '银'}</span>
        <span>
          <strong>{cumulativeFunding?.title || '银行资金闭环'}</strong>
          <small>{cumulativeFunding?.detail || '多笔流水 · 部分核销 · 剩余未结'}</small>
        </span>
        <em aria-hidden>›</em>
      </button>

      <button
        type="button"
        className={`bill360-contract-launcher is-${tone}`}
        onClick={() => setCheckOpen(true)}
        title="按合作方、游戏、账期和授权期匹配合同合作清单，并重算合同标准结算金额"
      >
        <span aria-hidden>合</span>
        <span>
          <strong>{launcherText(checkSummary, checkLoading, checkUnavailable)}</strong>
          <small>
            {amountSummary?.expected_amount != null
              ? `合同应结 ${money(amountSummary.expected_amount)} · 实际 ${money(amountSummary.actual_amount)} · ${amountVarianceText(amountSummary)}`
              : '固定合同依据 · 分成 · 税率 · 渠道费 · 标准结算重算'}
          </small>
          {dueInfo ? (
            <small className={`bill360-due-note ${dueTone}`.trim()}>
              到期 {dueInfo.dueDate} · {dueText} · {dueInfo.paymentTerms}
            </small>
          ) : cumulativeDeferred ? (
            <small className="bill360-due-note">累计结算中 · 未达门槛不计算催收逾期</small>
          ) : null}
        </span>
        <em aria-hidden>›</em>
      </button>

      {fundingOpen ? (
        <div className="bill360-funding-overlay" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setFundingOpen(false)
        }}>
          <aside className="bill360-funding-panel" role="dialog" aria-modal="true" aria-label={cumulativeFunding ? '累计结算与资金闭环' : '银行资金闭环'}>
            <header>
              <div>
                <span>{cumulativeFunding ? '账单 360° · 累计结算' : '账单 360° · P2'}</span>
                <h2>{cumulativeFunding?.title || '银行资金闭环'}</h2>
                <p>{cumulativeDeferred ? '本月账单已经完成核对；只有累计口径达到门槛并生成批次后，才进入统一开票、收款和银行核销。' : '以银行核销 allocation 为资金事实，反向汇总当前账单的每一笔真实银行分配。'}</p>
              </div>
              <button type="button" onClick={() => setFundingOpen(false)} aria-label="关闭资金闭环">×</button>
            </header>
            <main>
              {billType === 'channel' && cumulativeCondition?.mode === 'threshold' ? (
                <ChannelCumulativeSettlementCard
                  partnerName={cumulativeCondition.policy?.partner_name || target?.initialRecord?.partnerName || target?.initialRecord?.channelName || ''}
                  recordId={billId}
                  billStatus={target?.initialRecord?.status || 'confirmed'}
                  draftBasisAmount={0}
                  draftSettlementAmount={Number(target?.initialRecord?.settlementAmount || 0)}
                />
              ) : null}
              {cumulativeDeferred ? (
                <div className="bill360-funding-state">
                  当前无需登记收款或做银行核销。达到累计结算门槛并生成批次后，资金闭环会自动恢复。
                </div>
              ) : (
                <Bill360FundingPanel billType={billType} billId={billId} />
              )}
            </main>
          </aside>
        </div>
      ) : null}

      {checkOpen ? (
        <div
          className="bill360-contract-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setCheckOpen(false)
          }}
        >
          <aside className="bill360-contract-panel" role="dialog" aria-modal="true" aria-label="合同自动核验详情">
            <header className="bill360-contract-panel__head">
              <div>
                <span>账单 360° · 合同驱动核验 V3</span>
                <h2>合同自动核验 + 标准结算重算</h2>
                <p>锁定具体合作清单后，使用账单原始流水与扣项、合同数字条款重新计算应结金额，并量化多结/少结差额。</p>
              </div>
              <button type="button" onClick={() => setCheckOpen(false)} aria-label="关闭合同核验">×</button>
            </header>
            <main className="bill360-contract-panel__body">
              {amountSummary ? (
                <section className={`bill360-contract-amount-hero is-${amountSummary.status || 'warning'}`}>
                  <div className="bill360-contract-amount-hero__head">
                    <div>
                      <span>CONTRACT STANDARD SETTLEMENT</span>
                      <strong>{amountStatusText(amountSummary)}</strong>
                    </div>
                    <em>{amountVarianceText(amountSummary) || '待计算'}</em>
                  </div>
                  <div className="bill360-contract-amount-hero__grid">
                    <div><span>按合同应结</span><strong>{money(amountSummary.expected_amount)}</strong></div>
                    <div><span>账单实际</span><strong>{money(amountSummary.actual_amount)}</strong></div>
                    <div><span>差额（实际 - 应结）</span><strong>{amountSummary.difference_amount == null ? '-' : money(amountSummary.difference_amount)}</strong></div>
                    <div><span>自动重算覆盖</span><strong>{amountSummary.deterministic_lines}/{amountSummary.total_lines}</strong></div>
                  </div>
                  {!amountSummary.deterministic_complete ? (
                    <p>未能确定的明细不会被当成金额差异自动拦截；单价/CPA、固定费、保底和文本型扣除条款仍保留人工复核。</p>
                  ) : null}
                </section>
              ) : null}
              <BillContractCheckPanelV2 billType={billType} billId={billId} />
            </main>
          </aside>
        </div>
      ) : null}
    </>
  )
}

export default Bill360Drawer
