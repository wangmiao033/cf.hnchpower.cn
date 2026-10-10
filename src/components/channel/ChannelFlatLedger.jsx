import React, { useEffect, useMemo, useState } from 'react'
import { getChannelCumulativeBillStatuses } from '@/lib/api/channelCumulativeSettlement.ts'
import {
  getChannelTotals,
  getChannelReceivedAmount,
  isChannelReceiptSettled
} from '@/domain/channel/channelAggregates.js'
import { channelBillMonths } from '@/domain/reconciliation/sharedBillMonthOptions.js'
import { ledgerBillGames } from '@/domain/channel/channelFlatLedgerFilters.js'
import { getChannelBillNumber } from '@/utils/channelBillNumber.js'
import './ChannelFlatLedger.css'

function money(value) {
  return '¥' + Number(value || 0).toLocaleString('zh-CN', {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  })
}

function displayMonth(row) {
  const months = channelBillMonths(row)
  if (months.length === 0) return row.settlementMonth || '—'
  if (months.length === 1) return months[0]
  return months[0] + ' — ' + months[months.length - 1]
}

function hasDifference(row) {
  if (String(row.validationStatus) === 'fail') return true
  if (Math.abs(Number(row.settlementDifference || 0)) > 0.01) return true
  return (row.items || []).some(item =>
    item.validationStatus === 'fail' || Math.abs(Number(item.settlementDifference || 0)) > 0.01
  )
}

export default function ChannelFlatLedger({
  rows = [],
  selectedIds = [],
  archivedIds = new Set(),
  eligibleIds = new Set(),
  apiEnabled = true,
  busy = false,
  archiveWorkingId = '',
  pageSize = 50,
  page = 1,
  onPageChange,
  onPageSizeChange,
  onSelectPage,
  onToggleSelected,
  onDetail,
  onPrefetch,
  onReceipt,
  onEdit,
  onVoid,
  onArchive,
  onUnarchive,
  onRestore
}) {
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize))
  const effectivePage = Math.min(Math.max(1, page), totalPages)
  const offset = (effectivePage - 1) * pageSize
  const visibleRows = useMemo(() => rows.slice(offset, offset + pageSize), [rows, offset, pageSize])
  // Fully paid, archived and cancelled bills cannot enter a new cumulative
  // pool. Querying only unpaid active rows keeps the first flat view fast.
  const idsKey = visibleRows
    .filter(row => !isChannelReceiptSettled(row) &&
      !archivedIds.has(String(row.id)) &&
      !['cancelled', 'canceled'].includes(String(row.status || '').toLowerCase()))
    .map(row => String(row.id)).join(',')
  const [conditions, setConditions] = useState({})
  const [statusLoading, setStatusLoading] = useState(false)
  const [statusError, setStatusError] = useState(false)

  useEffect(() => {
    let cancelled = false
    setConditions({})
    setStatusError(false)
    if (!apiEnabled || !idsKey) {
      setStatusLoading(false)
      return undefined
    }
    setStatusLoading(true)
    getChannelCumulativeBillStatuses(idsKey.split(','))
      .then(result => {
        if (cancelled) return
        const next = {}
        ;(result?.items || []).forEach(item => {
          if (item?.bill_id) next[String(item.bill_id)] = item
        })
        setConditions(next)
      })
      .catch(error => {
        if (cancelled) return
        console.warn('[ChannelFlatLedger] cumulative statuses unavailable', error)
        setStatusError(true)
        setConditions({})
      })
      .finally(() => {
        if (!cancelled) setStatusLoading(false)
      })
    return () => { cancelled = true }
  }, [idsKey, apiEnabled])

  const selectedSet = useMemo(() => new Set(selectedIds.map(String)), [selectedIds])
  const selectables = visibleRows.filter(row =>
    !archivedIds.has(String(row.id)) && !['cancelled', 'canceled'].includes(String(row.status || '').toLowerCase())
  )
  const selectedCount = selectables.filter(row => selectedSet.has(String(row.id))).length
  const allSelected = selectables.length > 0 && selectedCount === selectables.length

  return (
    <section className="core-recon-panel channel-flat-ledger" aria-label="渠道账单明细列表">
      <div className="channel-flat-ledger__head">
        <div>
          <h2>账单明细</h2>
          <span>筛选后 {rows.length} 张账单 · 无需展开渠道 · 每张原始账单只计一次</span>
        </div>
        <div className="channel-flat-ledger__head-actions">
          {statusLoading ? <span>核对累计状态中…</span> : null}
          {statusError ? <span className="is-warning">累计状态读取失败，收款仍由后台校验</span> : null}
          <label>
            每页
            <select value={pageSize} aria-label="每页账单数量" onChange={event => onPageSizeChange?.(Number(event.target.value))}>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </label>
        </div>
      </div>
      <div className="channel-flat-ledger__scroll">
        <table className="channel-flat-ledger__table">
          <thead><tr>
            <th className="channel-flat-ledger__check">
              <input type="checkbox" aria-label="选择当前页全部可操作账单"
                ref={element => { if (element) element.indeterminate = selectedCount > 0 && !allSelected }}
                checked={allSelected} disabled={!selectables.length || busy}
                onChange={event => onSelectPage?.(selectables, event.target.checked)} />
            </th>
            <th>结算月份</th>
            <th>渠道 / 合作方</th>
            <th>游戏 / 账单编号</th>
            <th className="is-numeric">渠道应收</th>
            <th className="is-numeric">已收</th>
            <th className="is-numeric">未收</th>
            <th>核对 / 收款</th>
            <th>操作</th>
          </tr></thead>
          <tbody>
            {visibleRows.length ? visibleRows.map(row => {
              const id = String(row.id)
              const isArchived = archivedIds.has(id)
              const isCancelled = ['cancelled', 'canceled'].includes(String(row.status || '').toLowerCase())
              const settlement = Number(getChannelTotals(row).settlementAmount || 0)
              const received = Number(getChannelReceivedAmount(row) || 0)
              const unpaid = Math.max(0, settlement - received)
              const settled = isChannelReceiptSettled(row)
              const difference = hasDifference(row)
              const games = ledgerBillGames(row)
              const condition = conditions[id]
              const cumulative = !isArchived && !isCancelled && !settled && condition?.deferred &&
                ['accumulating', 'ready'].includes(condition.state)
              const label = isCancelled ? '已作废' : isArchived ? '已归档' : difference ? '数据差异'
                : cumulative ? (condition.state === 'ready' ? '累计达标' : '累计中')
                  : settled ? '已结清' : received > 0.01 ? '部分收款' : '未收款'
              const tone = isCancelled || isArchived ? 'muted' : difference ? 'anomaly' :
                cumulative ? 'cumulative' : settled ? 'paid' : 'unpaid'
              return (
                <tr key={id} className={selectedSet.has(id) ? 'is-selected' : ''}>
                  <td className="channel-flat-ledger__check">
                    <input type="checkbox" aria-label={'选择账单 ' + getChannelBillNumber(row)}
                      checked={selectedSet.has(id)} disabled={busy || isArchived || isCancelled}
                      onChange={() => onToggleSelected?.(id)} />
                  </td>
                  <td className="channel-flat-ledger__period" title={channelBillMonths(row).join('、')}>
                    {displayMonth(row)}
                    {channelBillMonths(row).length > 1 ? <small>跨月账单</small> : null}
                  </td>
                  <td className="channel-flat-ledger__partner">
                    <strong>{row.channelName || '未命名渠道'}</strong>
                    <small title={row.partnerName || ''}>{row.partnerName || '—'}</small>
                  </td>
                  <td className="channel-flat-ledger__game">
                    <strong title={games.join('、')}>{games.slice(0, 2).join('、') || '—'}{games.length > 2 ? ' +' + (games.length - 2) : ''}</strong>
                    <small title={getChannelBillNumber(row)}>{getChannelBillNumber(row)}</small>
                  </td>
                  <td className="is-numeric">{money(settlement)}</td>
                  <td className="is-numeric">{money(received)}</td>
                  <td className={'is-numeric ' + (unpaid > 0.01 ? 'has-unpaid' : '')}>{money(unpaid)}</td>
                  <td>
                    <span className={'channel-flat-ledger__status is-' + tone} title={condition?.batch?.batch_no || ''}>{label}</span>
                  </td>
                  <td>
                    <div className="channel-flat-ledger__row-actions">
                      <button type="button" onMouseEnter={() => onPrefetch?.(row)} onFocus={() => onPrefetch?.(row)} onClick={() => onDetail?.(row)}>详情</button>
                      {isCancelled ? (
                        <button type="button" disabled={busy} onClick={() => onRestore?.(row)}>恢复</button>
                      ) : isArchived ? (
                        <button type="button" disabled={!!archiveWorkingId} onClick={() => onUnarchive?.(row)}>取消归档</button>
                      ) : (
                        <>
                          {settled && eligibleIds.has(id) ? (
                            <button type="button" disabled={!!archiveWorkingId} onClick={() => onArchive?.(row)}>归档</button>
                          ) : (
                            <button type="button" className={cumulative ? 'is-disabled' : ''}
                              disabled={settled || !apiEnabled || cumulative || (statusLoading && !statusError)}
                              title={cumulative ? '已进入累计结算池，不能按单月收款' : statusLoading ? '正在核对累计结算状态' : '登记渠道收款'}
                              onClick={() => onReceipt?.(row)}>{settled ? '已结清' : cumulative ? '累计中' : '收款'}</button>
                          )}
                          <button type="button" onClick={() => onEdit?.(row)}>编辑</button>
                          <button type="button" className="is-danger" disabled={busy} onClick={() => onVoid?.(row)}>作废</button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              )
            }) : (
              <tr><td colSpan={9} className="channel-flat-ledger__empty">当前筛选条件下没有渠道账单。可修改筛选条件或进入账期巡检查看缺失月份。</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <footer className="channel-flat-ledger__footer">
        <span>{rows.length ? '显示第 ' + (offset + 1) + '–' + (offset + visibleRows.length) + ' 条，共 ' + rows.length + ' 条' : '0 条账单'} · 金额按全部筛选结果统计</span>
        <div>
          <button type="button" disabled={effectivePage <= 1} onClick={() => onPageChange?.(effectivePage - 1)}>上一页</button>
          <strong>{effectivePage} / {totalPages}</strong>
          <button type="button" disabled={effectivePage >= totalPages} onClick={() => onPageChange?.(effectivePage + 1)}>下一页</button>
        </div>
      </footer>
    </section>
  )
}
