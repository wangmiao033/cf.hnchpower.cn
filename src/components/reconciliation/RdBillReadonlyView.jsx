import React, { useEffect, useState } from 'react'
import { billStatusLabel } from '@/domain/reconciliation/billLifecycle.js'
import { rdRecordSettlementPeriodLabel } from '@/domain/reconciliation/rdSettlementPeriods.js'
import { billAttachmentFileUrl, listBillAttachments } from '@/lib/api/billAttachments.ts'
import '@/components/channel/ChannelBillReadonlyView.css'

const RD_LINE_COLUMNS = [
  ['结算月份', 'settlementCycle'],
  ['游戏', 'gameName'],
  ['后台流水', 'revenue', 'money'],
  ['折扣系数', 'discountRate', 'number'],
  ['折后流水', 'netRevenue', 'money'],
  ['代金券', 'couponAmount', 'money'],
  ['测试费', 'testFee', 'money'],
  ['其他费用', 'extraFee', 'money'],
  ['分成比例', 'shareRatio', 'percent'],
  ['税率', 'taxRate', 'percent'],
  ['分成金额', 'shareAmount', 'money'],
  ['结算金额', 'settlementAmount', 'money']
]

const RD_METRICS = [
  ['研发应结', 'settlementAmount'],
  ['预付款抵扣', 'prepaymentDeduction'],
  ['实际应付', 'actualPayable'],
  ['已付款', 'paidAmount'],
  ['未付款', 'unpaidAmount']
]

const RD_HEADER_TERMS = [
  ['账单编号', 'settlementNumber'],
  ['研发公司', 'partner'],
  ['合作方简称', 'partnerShortName'],
  ['分成比例（历史头部）', 'revenueShareRatio', 'percent'],
  ['通道费率（历史头部）', 'channelFeeRate', 'percent'],
  ['税率（历史头部）', 'taxPoint', 'percent'],
  ['结算折扣（历史头部）', 'discount', 'number'],
  ['账单备注', 'memo']
]

function display(value, format) {
  if (value === null || value === undefined || value === '') return '—'
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

/** Show the authoritative server-loaded RD record, without mounting its editable form. */
export default function RdBillReadonlyView({ record }) {
  const billId = String(record?.id || '')
  const [attachments, setAttachments] = useState([])
  const [attachmentLoading, setAttachmentLoading] = useState(true)
  const [attachmentError, setAttachmentError] = useState('')
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let active = true
    setAttachments([])
    setAttachmentError('')
    setAttachmentLoading(true)
    if (!billId) {
      setAttachmentError('缺少账单编号，无法读取附件')
      setAttachmentLoading(false)
      return undefined
    }
    listBillAttachments('rd', billId)
      .then(items => { if (active) setAttachments(items) })
      .catch(error => {
        if (active) setAttachmentError(error instanceof Error ? error.message : '附件读取失败')
      })
      .finally(() => { if (active) setAttachmentLoading(false) })
    return () => { active = false }
  }, [billId, retry])

  const rows = Array.isArray(record?.items) ? record.items : []
  const period = rdRecordSettlementPeriodLabel(record || {}) || record?.settlementMonth || '—'

  return (
    <div className="channel-readonly-view" aria-label="研发账单只读完整详情">
      <section className="channel-readonly-section">
        <header className="channel-readonly-section-head">
          <div>
            <span className="channel-readonly-eyebrow">原始研发账单 · 只读浏览</span>
            <h2>账单内容</h2>
            <p>直接展示服务器已保存的数据；查看不会触发保存、修改或重新计算。</p>
          </div>
          <span className="channel-readonly-state">{billStatusLabel(record?.status)}</span>
        </header>
        <dl className="channel-readonly-info">
          <InfoField label="账单编号" value={record?.settlementNumber} />
          <InfoField label="研发公司" value={record?.partner} />
          <InfoField label="账期" value={period} />
          <InfoField label="包含游戏" value={rows.map(line => line.gameName).filter(Boolean).join('、') || record?.game} />
        </dl>
      </section>

      <section className="channel-readonly-section">
        <header className="channel-readonly-section-head">
          <div>
            <h2>结算与付款</h2>
            <p>以下金额直接来自原账单及其已有付款、预付款信息，不按当前合同重新套算。</p>
          </div>
        </header>
        <dl className="channel-readonly-metrics">
          {RD_METRICS.map(([label, key]) => (
            <div className={'channel-readonly-metric' + (key === 'settlementAmount' ? ' is-primary' : '')} key={key}>
              <dt>{label}</dt>
              <dd>{display(record?.[key], 'money')}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="channel-readonly-section">
        <header className="channel-readonly-section-head">
          <div>
            <h2>逐游戏结算明细</h2>
            <p>横向滚动查看后台流水、折扣、代金券、测试费、分成比例、税率和结算金额。</p>
          </div>
          <span className="channel-readonly-count">{rows.length} 条</span>
        </header>
        {rows.length ? (
          <div className="channel-readonly-table-wrap" role="region" aria-label="研发账单原始逐游戏结算明细" tabIndex={0}>
            <table className="channel-readonly-table">
              <thead>
                <tr>{RD_LINE_COLUMNS.map(([label, key]) => <th key={key}>{label}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map((line, i) => (
                  <tr key={line.id || i}>
                    {RD_LINE_COLUMNS.map(([label, key, format]) => (
                      <td key={key} className={format ? 'is-numeric' : ''}>
                        {display(line[key], format)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="channel-readonly-empty">暂无逐游戏明细。</p>}
      </section>

      <section className="channel-readonly-section">
        <header className="channel-readonly-section-head">
          <div><h2>原始规则与备注</h2><p>记录账单确认时保存的头部参数；若有逐游戏分成规则，应以明细行数据为准。</p></div>
        </header>
        <dl className="channel-readonly-info">
          {RD_HEADER_TERMS.map(([label, key, format]) => (
            <InfoField key={key} label={label} value={record?.[key]} format={format} />
          ))}
        </dl>
      </section>

      <section className="channel-readonly-section">
        <header className="channel-readonly-section-head">
          <div><h2>账单附件</h2><p>仅可查看或下载，不能在只读浏览时删除或覆盖历史附件。</p></div>
          {!attachmentLoading && !attachmentError ? <span className="channel-readonly-count">{attachments.length} 个</span> : null}
        </header>
        {attachmentLoading ? <p className="channel-readonly-empty" role="status">正在读取附件…</p> : null}
        {attachmentError ? (
          <div className="channel-readonly-error" role="alert">
            附件读取失败：{attachmentError}
            <button type="button" onClick={() => setRetry(value => value + 1)}>重试</button>
          </div>
        ) : null}
        {!attachmentLoading && !attachmentError && !attachments.length ? (
          <p className="channel-readonly-empty">暂无附件</p>
        ) : null}
        {attachments.length ? (
          <ul className="channel-readonly-attachments">
            {attachments.map(file => (
              <li key={file.id}>
                <span title={file.file_name}>{file.file_name}</span>
                <a href={billAttachmentFileUrl('rd', billId, file.id)} target="_blank" rel="noreferrer">查看</a>
                <a href={billAttachmentFileUrl('rd', billId, file.id, false)}>下载</a>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  )
}
