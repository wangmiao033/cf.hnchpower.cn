import React, { useMemo, useState } from 'react'
import {
  auditChannelBillMonths,
  lastCompletedChannelMonth
} from '@/domain/channel/channelMonthCoverage.js'
import './ChannelMonthCoveragePanel.css'

function shortMonth(month) {
  const match = String(month || '').match(/^(20\d{2})-(\d{2})$/)
  return match ? Number(match[2]) + '月' : month
}

function fullMonth(month) {
  const match = String(month || '').match(/^(20\d{2})-(\d{2})$/)
  return match ? match[1] + '年' + Number(match[2]) + '月' : month
}

/**
 * Read-only monthly coverage dashboard. A gap is not proof that revenue exists.
 * All present and archived bills count; cancelled bills do not.
 */
export default function ChannelMonthCoveragePanel({
  records = [],
  onInspectMonth,
  onCreateBill,
  enabled = true,
  initialExpanded = false
}) {
  const [windowSize, setWindowSize] = useState(6)
  const [endMonth, setEndMonth] = useState(() => lastCompletedChannelMonth())
  const [expanded, setExpanded] = useState(initialExpanded)
  const [onlyGaps, setOnlyGaps] = useState(true)
  const [search, setSearch] = useState('')
  const latestFullMonth = lastCompletedChannelMonth()

  const audit = useMemo(
    () => auditChannelBillMonths(records, { endingMonth: endMonth, windowSize }),
    [records, endMonth, windowSize]
  )
  const listed = useMemo(() => audit.channels.filter((row) => {
    if (onlyGaps && row.gaps.length === 0) return false
    return row.name.toLocaleLowerCase('zh-CN').includes(search.trim().toLocaleLowerCase('zh-CN'))
  }), [audit.channels, onlyGaps, search])

  return (
    <section className="channel-month-audit" aria-label="渠道账期巡检">
      <header className="channel-month-audit__head">
        <div className="channel-month-audit__intro">
          <h2>账期巡检</h2>
          <p>自动查找渠道账期空档，仅作核对提醒</p>
        </div>
        <div className="channel-month-audit__inline-metrics" aria-label="账期巡检概况">
          <span className="is-important"><strong>{audit.gapChannelCount}</strong> 个渠道断档</span>
          <span><strong>{audit.gapMonthCount}</strong> 个月次待核实</span>
          <span><strong>{audit.trailingChannelCount}</strong> 个渠道期末未出账</span>
          <span><strong>{audit.coveredChannelCount}</strong> 个渠道已检查</span>
        </div>
        <button
          type="button"
          className="channel-month-audit__toggle"
          aria-expanded={expanded}
          aria-controls="channel-month-audit-details"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? '收起检查' : '展开检查'}
          <span aria-hidden="true">{expanded ? '⌃' : '⌄'}</span>
        </button>
      </header>
      {!enabled || records.length >= 500 ? (
        <div className="channel-month-audit__data-note" role="status">
          {!enabled
            ? '渠道接口暂未连接，巡检可能基于本机缓存。请恢复同步后复核。'
            : '已加载500张账单，可能仍有历史页未读取，巡检结果仅供参考。'}
        </div>
      ) : null}
      {expanded ? (
        <div id="channel-month-audit-details" className="channel-month-audit__body">
          <div className="channel-month-audit__filters">
            <label>
              <span>检查范围</span>
              <select
                value={windowSize}
                onChange={(event) => setWindowSize(Number(event.target.value))}
                aria-label="选择检查账期范围"
              >
                <option value={3}>近 3 个完整月份</option>
                <option value={6}>近 6 个完整月份</option>
                <option value={12}>近 12 个完整月份</option>
              </select>
            </label>
            <label>
              <span>截至账期</span>
              <input
                type="month"
                max={latestFullMonth}
                value={endMonth}
                onChange={(event) => setEndMonth(event.target.value && event.target.value <= latestFullMonth ? event.target.value : latestFullMonth)}
                aria-label="截至哪个已结束账期"
              />
            </label>
            <label className="channel-month-audit__search">
              <span>查找渠道</span>
              <input
                type="search"
                placeholder="输入渠道名称"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                aria-label="在巡检中搜索渠道"
              />
            </label>
            <label className="channel-month-audit__only">
              <input type="checkbox" checked={onlyGaps} onChange={(event) => setOnlyGaps(event.target.checked)} />
              只显示断档渠道
            </label>
          </div>

          {listed.length ? (
            <div className="channel-month-audit__scroll">
              <table className="channel-month-audit__matrix">
                <thead>
                  <tr>
                    <th scope="col">渠道</th>
                    {audit.months.map((month) => (
                      <th key={month} scope="col" title={fullMonth(month)}>
                        {shortMonth(month)}
                      </th>
                    ))}
                    <th scope="col">待核实断档</th>
                  </tr>
                </thead>
                <tbody>
                  {listed.map((row) => (
                    <tr key={row.key}>
                      <th scope="row" title={row.name}>
                        <strong>{row.name}</strong>
                        <small>{fullMonth(row.firstRecorded)}至{fullMonth(row.lastRecorded)}</small>
                      </th>
                      {row.cells.map((cell) => (
                        <td key={cell.month} className={'channel-month-audit__cell is-' + cell.kind}>
                          {cell.kind === 'recorded' ? (
                            <span title={fullMonth(cell.month) + ' 已有 ' + cell.count + ' 张账单（含归档）'}>
                              {cell.count}张
                            </span>
                          ) : cell.kind === 'before' ? (
                            <span title="该月早于本渠道首个已观察到账期，不判定是否漏账">—</span>
                          ) : (
                            <button
                              type="button"
                              title={cell.kind === 'gap' ? '两笔已录账期之间无账单，点击排查' : '最后已录账期之后暂无账单，点击排查'}
                              aria-label={'排查' + row.name + fullMonth(cell.month) + (cell.kind === 'gap' ? '账期断档' : '未出账')}
                              onClick={() => onInspectMonth?.(row.name, cell.month)}
                            >
                              {cell.kind === 'gap' ? '断档' : '未出'}
                            </button>
                          )}
                        </td>
                      ))}
                      <td className="channel-month-audit__gaps">
                        {row.gaps.length ? (
                          <span>{row.gaps.map(shortMonth).join('、')}</span>
                        ) : (
                          <span className="is-none">无内部断档</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="channel-month-audit__empty">
              <strong>{audit.gapChannelCount === 0 ? '当前检查范围内未发现内部账期断档' : '当前筛选条件下没有符合的渠道'}</strong>
              <span>可以切换为“显示全部渠道”，继续检查各渠道最后一张之后是否未出账。</span>
              {onlyGaps ? (
                <button type="button" onClick={() => setOnlyGaps(false)}>查看全部渠道</button>
              ) : null}
            </div>
          )}

          <div className="channel-month-audit__foot">
            <p><strong>标识：</strong>已录 = 有账单 · 断档 = 前后有记录但本月无账单 · 未出 = 最后一张之后暂无记录。仅供核查，不代表必有流水。</p>
            <div>
              <span>已归档计入 · 已作废不计 · 根据已加载账单统计</span>
              <button type="button" onClick={() => onCreateBill?.()}>新增渠道账单</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
