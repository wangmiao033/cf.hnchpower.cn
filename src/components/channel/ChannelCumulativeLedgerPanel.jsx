import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { getChannelCumulativeSnapshot } from '@/lib/api/channelCumulativeSettlement.ts'
import { channelPartnerNames, summarizeChannelUnpaid } from '@/domain/channel/channelCumulativeLedgerSummary.js'
import ChannelCumulativeSettlementCard from '@/components/channel/ChannelCumulativeSettlementCard.jsx'
import './ChannelCumulativeLedgerPanel.css'

function money(value) {
  const n = Number(value || 0)
  return '¥' + n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function monthLabel(value) {
  const match = String(value || '').match(/^(20\d{2})-(\d{2})$/)
  return match ? Number(match[2]) + '月' : (value || '—')
}

function monthRange(summary) {
  const a = summary.firstUnpaidMonth
  const b = summary.lastUnpaidMonth
  if (!a) return '无待收账期'
  if (a === b) return a.slice(0,4) + '年' + monthLabel(a)
  return a.slice(0,4) === b.slice(0,4)
    ? a.slice(0,4) + '年' + monthLabel(a) + '—' + monthLabel(b)
    : a.replace('-', '.') + '—' + b.replace('-', '.')
}

function activeBatchLabel(batch) {
  if (!batch) return ''
  const values = {
    ready: '批次待提交开票',
    invoicing: '财务开票中',
    invoiced: '已开票，待回款',
    settled: '批次已结清'
  }
  return values[batch.status] || String(batch.status || '')
}

/**
 * Compact read-only audit for the selected channel, with an explicit entry
 * into the existing partner-level cumulative policy / batch workflow.
 */
export default function ChannelCumulativeLedgerPanel({
  groupKey,
  channelName,
  records = [],
  archivedIds = [],
  apiEnabled = true,
  onSnapshot
}) {
  const partners = useMemo(() => channelPartnerNames(records, channelName), [records, channelName])
  const partnerFingerprint = partners.join('\u0001')
  const [selectedPartner, setSelectedPartner] = useState(() => partners.length === 1 ? partners[0] : '')
  const [showManager, setShowManager] = useState(false)
  const [refreshVersion, setRefreshVersion] = useState(0)
  const [snapshot, setSnapshot] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setSelectedPartner((current) => partners.includes(current) ? current : partners.length === 1 ? partners[0] : '')
  }, [partnerFingerprint])

  const summary = useMemo(
    () => summarizeChannelUnpaid(records, { partnerName: selectedPartner, archivedIds }),
    [records, selectedPartner, archivedIds]
  )

  useEffect(() => {
    let cancelled = false
    setSnapshot(null)
    setError('')
    // Invalidate stale row statuses immediately when switching partners or
    // reloading a policy. Only the server snapshot can mark a bill cumulative.
    onSnapshot?.(groupKey, null)
    if (!selectedPartner || !apiEnabled) {
      setLoading(false)
      return undefined
    }
    setLoading(true)
    getChannelCumulativeSnapshot(selectedPartner, 12)
      .then((result) => {
        if (cancelled) return
        setSnapshot(result)
        onSnapshot?.(groupKey, result)
      })
      .catch((err) => {
        if (cancelled) return
        const msg = err instanceof Error ? err.message : '结算策略读取失败'
        setError(msg)
        onSnapshot?.(groupKey, null)
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [selectedPartner, refreshVersion, apiEnabled, groupKey])

  const enabled = snapshot?.policy?.enabled && snapshot?.policy?.settlement_mode === 'threshold'
  const pool = enabled ? snapshot?.pool : null
  const threshold = Number(snapshot?.policy?.threshold_amount || 0)
  const basisText = snapshot?.policy?.threshold_basis === 'settlement_amount' ? '累计应收' : '累计流水'
  const lastBatch = (snapshot?.batches?.items || []).find((batch) => batch.status !== 'cancelled') || null

  const refresh = useCallback(() => setRefreshVersion((current) => current + 1), [])

  return (
    <section className="channel-cumulative-ledger" aria-label={channelName + '累计结算'}>
      <div className="channel-cumulative-ledger__main">
        <div className="channel-cumulative-ledger__identity">
          <span className="channel-cumulative-ledger__eyebrow">累计结算 · 合作方口径</span>
          <strong>{enabled ? '累计结算进行中' : '月度未收汇总'}</strong>
          <small>{selectedPartner ? monthRange(summary) : '请选择要设置的结算合作方'}</small>
        </div>

        {partners.length > 1 ? (
          <label className="channel-cumulative-ledger__partner">
            <span>结算合作方</span>
            <select aria-label="选择累计结算合作方" value={selectedPartner} onChange={(event) => {
              setSelectedPartner(event.target.value)
              setShowManager(false)
            }}>
              <option value="">请选择合作方，避免跨公司合并</option>
              {partners.map((name) => <option value={name} key={name}>{name}</option>)}
            </select>
          </label>
        ) : null}

        {selectedPartner ? (
          <div className="channel-cumulative-ledger__figures">
            <div><span>当前渠道账面未收</span><strong>{money(summary.unpaid)}</strong><small>{summary.unpaidCount} 张账单</small></div>
            <div><span>已核对未收</span><strong>{money(summary.confirmedUnpaid)}</strong><small>是否可入池以服务器为准</small></div>
            <div><span>{enabled ? '正式累计池应收' : '正式累计池'}</span><strong>{enabled ? money(pool?.settlement_total) : '未启用'}</strong><small>{enabled ? (pool?.bill_count || 0) + ' 张已进入池' : '还未设置累计规则'}</small></div>
          </div>
        ) : null}

        <div className="channel-cumulative-ledger__actions">
          {loading ? <span className="channel-cumulative-ledger__loading">读取策略中…</span> : null}
          {selectedPartner && enabled ? <span className={'channel-cumulative-ledger__status ' + (pool?.ready ? 'is-ready' : '')}>{pool?.ready ? '已达到门槛' : '累计中'}</span> : null}
          {selectedPartner && !enabled && !loading && !error ? <span className="channel-cumulative-ledger__status is-neutral">目前按月结算</span> : null}
          <button
            type="button"
            className="channel-cumulative-ledger__configure"
            disabled={!selectedPartner || !apiEnabled || loading}
            onClick={() => setShowManager((current) => !current)}
          >{showManager ? '收起设置' : enabled ? '查看累计设置' : '设置累计结算'}</button>
          <button type="button" className="channel-cumulative-ledger__refresh" disabled={!selectedPartner || !apiEnabled || loading} onClick={refresh}>刷新</button>
        </div>
      </div>

      {selectedPartner ? (
        <div className="channel-cumulative-ledger__notes">
          {enabled ? (
            <span>
              约定口径：{basisText}达到 {money(threshold)} 后统一开票收款。
              已进入累计池：{money(pool?.basis_total)}{pool?.ready ? '，已达到结算条件' : '，距离门槛还差 ' + money(pool?.remaining_to_threshold)}。
            </span>
          ) : (
            <span>当前仅统计未收款，尚未启用累计规则。设置前请核对合同门槛和累计口径；不会自动修改已有账单。</span>
          )}
          {summary.notReviewedCount > 0 ? (
            <span className="channel-cumulative-ledger__review-warning">
              {summary.notReviewedCount} 张账单（共 {money(summary.notReviewed)}）需核对或检查部分收款，不能直接认定已入累计池。
            </span>
          ) : null}
          {lastBatch ? <span>最近批次：{lastBatch.batch_no} · {activeBatchLabel(lastBatch)} · {money(lastBatch.settlement_total)}</span> : null}
        </div>
      ) : (
        <div className="channel-cumulative-ledger__notes">当前渠道可能对应多个法律主体。累计结算按合作方生效，请分别选择，不会跨公司合并。</div>
      )}
      {!apiEnabled || error ? (
        <div className="channel-cumulative-ledger__warning" role="status">
          {!apiEnabled ? '当前为离线模式，无法核实或设置累计结算。' : '累计策略读取异常：' + error + '。请恢复后再操作。'}
        </div>
      ) : null}

      {showManager && selectedPartner && apiEnabled ? (
        <div className="channel-cumulative-ledger__manager">
          <ChannelCumulativeSettlementCard
            key={selectedPartner}
            partnerName={selectedPartner}
            onChanged={refresh}
            expandSettings
          />
        </div>
      ) : null}
    </section>
  )
}
