import BillActorSummary from '@/components/reconciliation/BillActorSummary.jsx'
import React, { useEffect, useState } from 'react'
import { apiChannelRowToFrontend, getChannelRecord } from '@/lib/api/channel.ts'
import { billAttachmentFileUrl, listBillAttachments } from '@/lib/api/billAttachments.ts'
import { billStatusLabel } from '@/domain/reconciliation/billLifecycle.js'
import './ChannelBillReadonlyView.css'

const MONEY_FIELDS = [
  ['后台流水', 'flow'],
  ['计费金额', 'billingAmount'],
  ['分成金额', 'shareAmount'],
  ['系统核算', 'systemSettlementAmount'],
  ['平台结算', 'platformSettlementAmount'],
  ['系统与平台差额', 'settlementDifference'],
  ['最终结算金额', 'settlementAmount'],
  ['已收款', 'receivedAmount']
]

const LINE_COLUMNS = [
  ['结算月份', 'settlementCycle'],
  ['游戏', 'gameName'],
  ['后台流水', 'flow', 'money'],
  ['流水口径', 'revenueBasis', 'revenueBasis'],
  ['折扣系数', 'discountFactor', 'number'],
  ['计费金额', 'billingAmount', 'money'],
  ['代金券', 'voucherCost', 'money'],
  ['无忧费用', 'noWorryCost', 'money'],
  ['退款', 'refundCost', 'money'],
  ['测试费', 'testCost', 'money'],
  ['福利币', 'welfareCost', 'money'],
  ['游戏币', 'coinCost', 'money'],
  ['分成比例', 'shareRate', 'percent'],
  ['分成金额', 'shareAmount', 'money'],
  ['税率', 'taxRate', 'percent'],
  ['固定通道费', 'gatewayCost', 'money'],
  ['通道费率', 'channelFeeRate', 'percent'],
  ['系统结算', 'systemSettlementAmount', 'money'],
  ['平台结算', 'platformSettlementAmount', 'money'],
  ['差额', 'settlementDifference', 'money'],
  ['实际结算', 'settlementAmount', 'money'],
  ['校验结果', 'validationStatus', 'validation']
]

const BRIEF_COLUMNS = [
  ['游戏', 'gameName'],
  ['后台流水', 'flow', 'money'],
  ['流水口径', 'revenueBasis', 'revenueBasis'],
  ['代金券', 'voucherCost', 'money'],
  ['分成比例', 'shareRate', 'percent'],
  ['通道费率', 'channelFeeRate', 'percent'],
  ['平台实结', 'platformSettlementAmount', 'money'],
  ['校验', 'validationStatus', 'validation']
]

const VALIDATION_LABELS = {
  pass: '一致',
  fail: '存在差异',
  partial: '部分校验',
  unvalidated: '未校验'
}

const ADJUSTMENT_LABELS = {
  historical_carryover: '历史差额结转',
  business_makeup: '商务补差',
  offset: '补扣 / 冲抵',
  other: '其他'
}

const FEE_MODE_LABELS = {
  none: '不扣渠道费',
  percent: '按百分比扣除',
  fixed: '固定费用'
}

const TAX_MODE_LABELS = {
  none: '税率仅记录',
  share: '按分成金额扣税',
  after_fee: '通道费后扣税'
}

export function displayRevenueBasis(value) {
  if (value == null || value === '' || value === 'pre_discount') return '折前原始流水（按折扣换算）'
  if (value === 'post_discount') return '已折后流水（不再乘游戏折扣）'
  return '未知流水口径（请核对）'
}

function display(value, format) {
  if (format === 'revenueBasis') return displayRevenueBasis(value)
  if (value === null || value === undefined || value === '') return '-'
  if (format === 'validation') return VALIDATION_LABELS[value] || String(value)
  if (format === 'money') {
    const number = Number(value)
    return Number.isFinite(number)
      ? '¥' + number.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : String(value)
  }
  if (format === 'percent') return String(value) + '%'
  return String(value)
}

function InfoField({ label, value, format }) {
  return (
    <div className="channel-readonly-field">
      <dt>{label}</dt>
      <dd>{display(value, format)}</dd>
    </div>
  )
}

export default function ChannelBillReadonlyView({ recordId, fallbackRecord }) {
  const billId = String(recordId || '')
  const [record, setRecord] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [attachments, setAttachments] = useState([])
  const [attachmentError, setAttachmentError] = useState('')
  const [attachmentLoading, setAttachmentLoading] = useState(false)
  const [attachmentsLoaded, setAttachmentsLoaded] = useState(false)
  const [openedSections, setOpenedSections] = useState({})
  const [reload, setReload] = useState(0)

  const onDetailToggle = (name, event) => {
    const open = event.currentTarget.open
    setOpenedSections(previous => previous[name] === open ? previous : { ...previous, [name]: open })
  }

  useEffect(() => {
    let active = true
    setRecord(null)
    setError('')
    setAttachments([])
    setAttachmentError('')
    setLoading(true)
    setAttachmentLoading(false)
    setAttachmentsLoaded(false)

    if (!billId) {
      setLoading(false)
      setAttachmentLoading(false)
      setError('缺少账单编号，无法读取明细')
      return undefined
    }

    // Only GET endpoints are used here. A locked bill must never be re-saved or recalculated.
    getChannelRecord(billId)
      .then((row) => {
        if (active) setRecord(apiChannelRowToFrontend(row))
      })
      .catch((cause) => {
        if (active) setError(cause?.message || '账单明细读取失败')
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => { active = false }
  }, [billId, reload])

  // Attachments are secondary audit content. Fetch them only when the user
  // opens the attachment section; otherwise they compete with the visible
  // settlement/game-data request and slow down the first paint.
  useEffect(() => {
    if (!billId || !openedSections.attachments || attachmentsLoaded) return undefined
    let active = true
    setAttachmentLoading(true)
    setAttachmentError('')
    listBillAttachments('channel', billId)
      .then(files => {
        if (!active) return
        setAttachments(files)
        setAttachmentsLoaded(true)
      })
      .catch(cause => {
        if (active) setAttachmentError(cause?.message || '附件列表读取失败')
      })
      .finally(() => {
        if (active) setAttachmentLoading(false)
      })
    return () => { active = false }
  }, [billId, openedSections.attachments, attachmentsLoaded, reload])

  const snapshot = record || fallbackRecord || {}
  const lines = Array.isArray(record?.items) ? record.items : []
  const adjustmentType = snapshot.settlementAdjustmentType || ''
  const hasAdjustment = Boolean(
    adjustmentType || snapshot.settlementAdjustmentSourceMonth ||
    Number(snapshot.settlementAdjustmentAmount || 0) ||
    snapshot.settlementFinalOverride != null ||
    snapshot.settlementAdjustmentReason
  )

  return (
    <div className="channel-readonly-view" aria-label="渠道账单完整只读详情">
      <div className="channel-readonly-identity" aria-label="账单基础身份">
        <strong>{snapshot.partnerName || snapshot.channelName || '合作方未填写'}</strong>
        <span>账期 {snapshot.settlementMonth || '-'}</span>
        <span>单号 {snapshot.billNumber || snapshot.statementNo || '-'}</span>
      </div>

      {error ? (
        <div className="channel-readonly-error" role="alert">
          账单明细读取失败：{error}
          <button type="button" onClick={() => setReload((value) => value + 1)}>重试读取</button>
        </div>
      ) : null}

      <section className="channel-readonly-section is-brief-games">
        <header className="channel-readonly-section-head">
          <div>
            <h2>游戏结算明细</h2>
            <p>先看每款游戏的流水、代金券和实际结算，完整计算字段可展开。</p>
          </div>
          <span className="channel-readonly-count">{record ? `${lines.length} 条` : '读取中'}</span>
        </header>
        <div className="channel-readonly-table-wrap" role="region" aria-label="游戏结算简明表" tabIndex={0}>
          <table className="channel-readonly-table channel-readonly-table--brief">
            <thead><tr>{BRIEF_COLUMNS.map(([label, key]) => <th key={key}>{label}</th>)}</tr></thead>
            <tbody>
              {record && lines.length ? lines.map((line, index) => (
                <tr key={line.id || index}>
                  {BRIEF_COLUMNS.map(([label, key, format]) => (
                    <td key={key} className={format === 'money' || format === 'percent' ? 'is-numeric' : ''}>
                      {display(key === 'channelFeeRate' ? line.channelFeeRate ?? snapshot.channelFeeRate : line[key], format)}
                    </td>
                  ))}
                </tr>
              )) : (
                <tr>
                  <td colSpan={BRIEF_COLUMNS.length} className="channel-readonly-brief-empty">
                    {loading ? '正在读取服务器的游戏明细…' : '暂无可显示的游戏结算明细'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <BillActorSummary billType="channel" billId={recordId} />
      <details className="channel-readonly-fold" onToggle={event => onDetailToggle('calculations', event)}>
        <summary>全部结算计算字段 <small>完整扣减、分成、税率、系统及平台金额</small></summary>
        {openedSections.calculations ? (

      <section className="channel-readonly-section">
        <div className="channel-readonly-section-head">
          <div><h2>逐游戏结算明细</h2><p>可左右滚动查看所有扣减项、分成、通道费和系统/平台结算差异。</p></div>
          {record ? <span className="channel-readonly-count">{lines.length} 条</span> : null}
        </div>
        {record ? (
          lines.length ? (
            <div className="channel-readonly-table-wrap" role="region" aria-label="渠道账单逐游戏明细" tabIndex={0}>
              <table className="channel-readonly-table">
                <thead><tr>{LINE_COLUMNS.map(([label, key]) => <th key={key}>{label}</th>)}</tr></thead>
                <tbody>
                  {lines.map((line, index) => (
                    <tr key={line.id || index}>
                      {LINE_COLUMNS.map(([label, key, format]) => (
                        <td key={key} className={format === 'money' || format === 'percent' || format === 'number' ? 'is-numeric' : ''}>
                          {display(line[key], format)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="channel-readonly-empty">服务器未返回逐游戏明细。</p>
        ) : <p className="channel-readonly-empty">{loading ? '明细加载中…' : '暂无可显示的明细，请重试读取。'}</p>}
      </section>

        ) : null}
      </details>

      <details className="channel-readonly-fold" onToggle={event => onDetailToggle('background', event)}>
        <summary>账单资料与金额构成 <small>流水、计费、分成、实结与已收款</small></summary>
        {openedSections.background ? (<>

      <section className="channel-readonly-section">
        <header className="channel-readonly-section-head">
          <div>
            <span className="channel-readonly-eyebrow">历史账单 · 只读</span>
            <h2>账单内容</h2>
            <p>显示服务器保存的金额与核对记录，不会重新计算、改写或提交账单。</p>
          </div>
          <span className="channel-readonly-state">{billStatusLabel(snapshot.status)}</span>
        </header>

        {error ? (
          <div className="channel-readonly-error" role="alert">
            明细读取失败：{error}。
            <button type="button" onClick={() => setReload((value) => value + 1)}>重试读取</button>
          </div>
        ) : null}
        {loading ? <p className="channel-readonly-loading" role="status">正在读取服务器上的完整账单明细…</p> : null}

        <dl className="channel-readonly-info">
          <InfoField label="账单编号" value={snapshot.billNumber || snapshot.statementNo} />
          <InfoField label="合作方" value={snapshot.partnerName} />
          <InfoField label="渠道" value={snapshot.channelName} />
          <InfoField label="账单月份" value={snapshot.settlementMonth} />
          <InfoField label="起始日期" value={snapshot.startDate} />
          <InfoField label="结束日期" value={snapshot.endDate} />
          <InfoField label="产品" value={snapshot.gameName || lines.map((item) => item.gameName).filter(Boolean).join('、')} />
          <InfoField label="创建时间" value={snapshot.createdAt} />
        </dl>
      </section>

      <section className="channel-readonly-section">
        <div className="channel-readonly-section-head">
          <div><h2>金额汇总</h2><p>以下金额直接来自已保存账单，不按当前合同重新套算。</p></div>
        </div>
        <dl className="channel-readonly-metrics">
          {MONEY_FIELDS.map(([label, field]) => (
            <div key={field} className={field === 'settlementAmount' ? 'channel-readonly-metric is-primary' : 'channel-readonly-metric'}>
              <dt>{label}</dt><dd>{display(snapshot[field], 'money')}</dd>
            </div>
          ))}
        </dl>
      </section>

        </>) : null}
      </details>

      <details className="channel-readonly-fold" onToggle={event => onDetailToggle('rules', event)}>
        <summary>结算规则、历史备注与调整 <small>{hasAdjustment ? '有调整记录 · 可展开核查' : '审计备查 · 默认收起'}</small></summary>
        {openedSections.rules ? (

      <section className="channel-readonly-section">
        <div className="channel-readonly-section-head"><div><h2>结算规则与调整</h2><p>保留账单确认时已记录的规则参数和调整依据。</p></div></div>
        <dl className="channel-readonly-info">
          <InfoField label="规则代码" value={snapshot.settlementRuleCode} />
          <InfoField label="渠道费模式" value={FEE_MODE_LABELS[snapshot.channelFeeMode] || snapshot.channelFeeMode} />
          <InfoField label="渠道费率" value={snapshot.channelFeeRate} format="percent" />
          <InfoField label="税费处理" value={TAX_MODE_LABELS[snapshot.taxMode] || snapshot.taxMode} />
          <InfoField label="差异容差" value={snapshot.validationTolerance} format="money" />
          <InfoField label="校验结果" value={snapshot.validationStatus} format="validation" />
          <InfoField label="调整类型" value={hasAdjustment ? (ADJUSTMENT_LABELS[adjustmentType] || adjustmentType || '未分类') : '无调整'} />
          <InfoField label="调整来源月份" value={snapshot.settlementAdjustmentSourceMonth} />
          <InfoField label="调整金额" value={snapshot.settlementAdjustmentAmount} format="money" />
          <InfoField label="最终确认金额" value={snapshot.settlementFinalOverride} format="money" />
          <InfoField label="调整原因" value={snapshot.settlementAdjustmentReason} />
          <InfoField label="账单备注" value={snapshot.remark} />
        </dl>
        {record && lines.some((item) => item.settlementRuleCode || item.channelFeeMode || item.taxMode) ? (
          <div className="channel-readonly-table-wrap" role="region" aria-label="逐游戏结算规则" tabIndex={0}>
            <table className="channel-readonly-table channel-readonly-table--rules">
              <thead><tr><th>游戏</th><th>结算月份</th><th>规则代码</th><th>渠道费模式</th><th>渠道费率</th><th>税费处理</th><th>差异容差</th></tr></thead>
              <tbody>{lines.map((line, index) => (
                <tr key={line.id || index}>
                  <td>{display(line.gameName)}</td>
                  <td>{display(line.settlementCycle)}</td>
                  <td>{display(line.settlementRuleCode || snapshot.settlementRuleCode)}</td>
                  <td>{display(FEE_MODE_LABELS[line.channelFeeMode] || FEE_MODE_LABELS[snapshot.channelFeeMode] || line.channelFeeMode || snapshot.channelFeeMode)}</td>
                  <td className="is-numeric">{display(line.channelFeeRate ?? snapshot.channelFeeRate, 'percent')}</td>
                  <td>{display(TAX_MODE_LABELS[line.taxMode] || TAX_MODE_LABELS[snapshot.taxMode] || line.taxMode || snapshot.taxMode)}</td>
                  <td className="is-numeric">{display(line.validationTolerance ?? snapshot.validationTolerance, 'money')}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : null}
      </section>

        ) : null}
      </details>

      <details className="channel-readonly-fold" onToggle={event => onDetailToggle('attachments', event)}>
        <summary>原始账单附件 <small>{attachmentError ? '附件读取失败' : attachmentLoading ? '读取中' : attachmentsLoaded ? `${attachments.length} 个` : '按需查看'}</small></summary>
        {openedSections.attachments ? (

      <section className="channel-readonly-section">
        <div className="channel-readonly-section-head">
          <div><h2>原始账单附件</h2><p>仅支持查看与下载，不提供上传或删除操作。</p></div>
          {!attachmentLoading && !attachmentError ? <span className="channel-readonly-count">{attachments.length} 个</span> : null}
        </div>
        {attachmentLoading ? <p className="channel-readonly-empty">正在读取附件…</p> : null}
        {attachmentError ? <p className="channel-readonly-error" role="alert">附件读取失败：{attachmentError}</p> : null}
        {!attachmentLoading && !attachmentError && !attachments.length ? <p className="channel-readonly-empty">暂无附件</p> : null}
        {attachments.length ? (
          <ul className="channel-readonly-attachments">
            {attachments.map((item) => (
              <li key={item.id}>
                <span title={item.file_name}>{item.file_name}</span>
                <a href={billAttachmentFileUrl('channel', billId, item.id)} target="_blank" rel="noreferrer">查看</a>
                <a href={billAttachmentFileUrl('channel', billId, item.id, false)}>下载</a>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
        ) : null}
      </details>
    </div>
  )
}
