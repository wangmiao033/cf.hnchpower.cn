import React, { useEffect, useMemo, useState } from 'react'
import { normalizeChannelSettlementCycle } from '@/domain/channel/channelBillingForm.js'
import {
  CHANNEL_FLOW_INPUT_STATE,
  normalizeChannelTextKey,
  resolveChannelFlowInputState
} from '@/domain/channel/channelFlowInput.js'
import { listContracts } from '@/lib/api/contract.ts'
import { VIEWS } from '@/app/routes.js'
import './ChannelMonthCloseLauncher.css'

export const CHANNEL_MONTH_CLOSE_SEED_KEY = 'channel-month-close-seed-v1'

function currentMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function monthValue(value) {
  const normalized = normalizeChannelSettlementCycle(value)
  const match = String(normalized || value || '').match(/^(20\d{2})[-年/.](0?[1-9]|1[0-2])/)
  return match ? `${match[1]}-${String(Number(match[2])).padStart(2, '0')}` : ''
}

function lineMonth(line, record) {
  return monthValue(line?.settlementCycle) || monthValue(record?.settlementMonth)
}

function accessCoversMonth(item, month) {
  if (['已过期', '已终止'].includes(String(item?.timeline_status || ''))) return false
  const start = monthValue(item?.authorization_start)
  const end = monthValue(item?.authorization_end)
  if (start && month < start) return false
  if (end && month > end) return false
  return true
}

function contractPartner(contract) {
  return String(contract?.partner_name || contract?.partner_short_name || contract?.counterparty || '').trim()
}

function channelForAccess(contract, item) {
  return String(item?.channel_name || contract?.partner_short_name || contractPartner(contract)).trim()
}

function sameGroupRecord(record, partnerName, channelName) {
  const wantedPartner = normalizeChannelTextKey(partnerName)
  const wantedChannel = normalizeChannelTextKey(channelName)
  const recordPartner = normalizeChannelTextKey(record?.partnerName)
  const recordChannel = normalizeChannelTextKey(record?.channelName)
  if (wantedPartner && recordPartner === wantedPartner) {
    return !wantedChannel || recordChannel === wantedChannel || !recordChannel
  }
  if (wantedChannel && recordChannel === wantedChannel) return true
  return false
}

function monthLines(record, month) {
  return (Array.isArray(record?.items) ? record.items : [])
    .filter((line) => String(line?.gameName || '').trim())
    .filter((line) => lineMonth(line, record) === month)
}

function bestEditableRecord(records) {
  const candidates = [...records].filter((record) => String(record?.status || '') !== 'cancelled')
  return candidates.sort((left, right) => {
    const score = (record) => {
      const status = String(record?.status || 'pending')
      if (status === 'pending' || status === 'draft' || !status) return 0
      if (status === 'confirmed') return 1
      if (status === 'completed') return 2
      return 3
    }
    return score(left) - score(right)
  })[0] || null
}

function writeSeed(seed) {
  try {
    window.sessionStorage.setItem(CHANNEL_MONTH_CLOSE_SEED_KEY, JSON.stringify(seed))
    return true
  } catch {
    return false
  }
}

export default function ChannelMonthCloseLauncher({
  channelRecords = [],
  onNavigate,
  onOpenEdit,
  onNotice
}) {
  const [month, setMonth] = useState(currentMonth)
  const [expanded, setExpanded] = useState(true)
  const [contractState, setContractState] = useState({ loading: true, items: [], error: '' })

  useEffect(() => {
    let cancelled = false
    setContractState((current) => ({ ...current, loading: true, error: '' }))
    listContracts({ limit: 500, offset: 0 })
      .then((result) => {
        if (cancelled) return
        setContractState({ loading: false, items: Array.isArray(result?.items) ? result.items : [], error: '' })
      })
      .catch((error) => {
        if (cancelled) return
        setContractState({ loading: false, items: [], error: error instanceof Error ? error.message : '合同清单读取失败' })
      })
    return () => { cancelled = true }
  }, [])

  const groups = useMemo(() => {
    const map = new Map()
    for (const contract of contractState.items || []) {
      if (['已过期'].includes(String(contract?.timeline_status || ''))) continue
      const partnerName = contractPartner(contract)
      if (!partnerName) continue
      for (const accessItem of contract?.access_items || []) {
        const gameName = String(accessItem?.product_name || '').trim()
        if (!gameName || !accessCoversMonth(accessItem, month)) continue
        const channelName = channelForAccess(contract, accessItem)
        const key = `${normalizeChannelTextKey(partnerName)}|${normalizeChannelTextKey(channelName)}`
        if (!map.has(key)) {
          map.set(key, {
            key,
            partnerName,
            channelName,
            contracts: new Set(),
            expectedGames: new Map()
          })
        }
        const group = map.get(key)
        group.contracts.add(String(contract?.internal_contract_no || contract?.contract_no || contract?.contract_name || '').trim())
        const gameKey = normalizeChannelTextKey(gameName)
        if (!group.expectedGames.has(gameKey)) group.expectedGames.set(gameKey, gameName)
      }
    }

    return [...map.values()].map((group) => {
      const records = (channelRecords || []).filter((record) => {
        if (String(record?.status || '') === 'cancelled') return false
        if (!sameGroupRecord(record, group.partnerName, group.channelName)) return false
        const recordMonths = new Set((Array.isArray(record?.items) ? record.items : []).map((line) => lineMonth(line, record)).filter(Boolean))
        if (!recordMonths.size) recordMonths.add(monthValue(record?.settlementMonth))
        return recordMonths.has(month)
      })
      const actualLines = records.flatMap((record) => monthLines(record, month))
      const actualGames = new Map()
      actualLines.forEach((line) => {
        const name = String(line?.gameName || '').trim()
        if (name) actualGames.set(normalizeChannelTextKey(name), name)
      })
      const missingGames = [...group.expectedGames.entries()]
        .filter(([key]) => !actualGames.has(key))
        .map(([, name]) => name)
      const expectedBuiltCount = [...group.expectedGames.keys()].filter((key) => actualGames.has(key)).length
      const missingFlowLines = actualLines.filter((line) => resolveChannelFlowInputState(line) === CHANNEL_FLOW_INPUT_STATE.MISSING)
      const editableRecord = bestEditableRecord(records)
      const pendingBills = records.filter((record) => ['pending', 'draft', ''].includes(String(record?.status || 'pending'))).length
      return {
        ...group,
        contractList: [...group.contracts].filter(Boolean),
        expectedGameList: [...group.expectedGames.values()],
        expectedCount: group.expectedGames.size,
        actualCount: expectedBuiltCount,
        extraActualCount: Math.max(0, actualGames.size - expectedBuiltCount),
        missingGames,
        missingFlowCount: missingFlowLines.length,
        missingFlowGames: missingFlowLines.map((line) => String(line.gameName || '').trim()).filter(Boolean),
        records,
        editableRecord,
        pendingBills
      }
    }).sort((left, right) => {
      const leftRisk = left.missingGames.length * 10 + left.missingFlowCount * 5 + left.pendingBills
      const rightRisk = right.missingGames.length * 10 + right.missingFlowCount * 5 + right.pendingBills
      if (leftRisk !== rightRisk) return rightRisk - leftRisk
      return left.channelName.localeCompare(right.channelName, 'zh-CN')
    })
  }, [contractState.items, channelRecords, month])

  const summary = useMemo(() => groups.reduce((acc, group) => {
    acc.expected += group.expectedCount
    acc.built += group.actualCount
    acc.missing += group.missingGames.length
    acc.missingFlow += group.missingFlowCount
    acc.pendingBills += group.pendingBills
    return acc
  }, { expected: 0, built: 0, missing: 0, missingFlow: 0, pendingBills: 0 }), [groups])

  const openGroup = (group) => {
    const seed = {
      version: 1,
      month,
      partnerName: group.partnerName,
      channelName: group.channelName,
      games: group.missingGames.length ? group.missingGames : group.expectedGameList,
      source: 'month-close',
      billId: group.editableRecord?.id ? String(group.editableRecord.id) : ''
    }
    writeSeed(seed)
    if (group.editableRecord?.id) {
      onOpenEdit?.(String(group.editableRecord.id))
      return
    }
    onNavigate?.(VIEWS.CHANNEL_RECON_CREATE)
  }

  const completionRate = summary.expected ? Math.round(summary.built / summary.expected * 100) : 0
  const clear = summary.expected > 0 && summary.missing === 0 && summary.missingFlow === 0 && summary.pendingBills === 0

  return (
    <section className={`channel-month-close ${clear ? 'is-clear' : ''}`}>
      <div className="channel-month-close__head">
        <div>
          <span>V3.3 · 月结启动器</span>
          <strong>{month.replace('-', '年')}月渠道月结</strong>
          <small>合同合作清单决定“本月应该做什么账”；充值流水仍由你手工录入。</small>
        </div>
        <div className="channel-month-close__head-tools">
          <label><span>月结月份</span><input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label>
          <button type="button" onClick={() => setExpanded((value) => !value)}>{expanded ? '收起矩阵' : '展开矩阵'}</button>
        </div>
      </div>

      <div className="channel-month-close__summary">
        <div><span>合同应有</span><strong>{summary.expected}</strong><small>游戏项</small></div>
        <div><span>已建账</span><strong>{summary.built}</strong><small>{completionRate}%</small></div>
        <div className={summary.missing ? 'is-risk' : ''}><span>缺账</span><strong>{summary.missing}</strong><small>游戏项</small></div>
        <div className={summary.missingFlow ? 'is-warning' : ''}><span>待录流水</span><strong>{summary.missingFlow}</strong><small>游戏项</small></div>
        <div className={summary.pendingBills ? 'is-warning' : ''}><span>待核对账单</span><strong>{summary.pendingBills}</strong><small>张</small></div>
      </div>

      {contractState.error ? <div className="channel-month-close__notice is-error">合同清单读取失败：{contractState.error}</div> : null}
      {!contractState.loading && !contractState.error && !groups.length ? <div className="channel-month-close__notice">这个月份没有识别到生效中的渠道合同合作清单。</div> : null}

      {expanded ? (
        <div className="channel-month-close__matrix-wrap">
          <table className="channel-month-close__matrix">
            <thead><tr><th>渠道 / 合作方</th><th>合同应有</th><th>已建账</th><th>缺账</th><th>待录流水</th><th>账单状态</th><th>动作</th></tr></thead>
            <tbody>
              {contractState.loading ? <tr><td colSpan={7} className="channel-month-close__empty">正在读取合同合作清单…</td></tr> : null}
              {!contractState.loading && groups.map((group) => {
                const hasRisk = group.missingGames.length || group.missingFlowCount
                const statusLabel = !group.records.length
                  ? '尚未建账'
                  : group.pendingBills
                    ? `${group.pendingBills} 张待核对`
                    : hasRisk
                      ? '资料未齐'
                      : '本月已齐'
                return (
                  <tr key={group.key} className={hasRisk ? 'has-risk' : ''}>
                    <td><strong>{group.channelName}</strong><small>{group.partnerName}</small><em>{group.contractList.slice(0, 2).join(' · ') || '合同清单'}</em></td>
                    <td><strong>{group.expectedCount}</strong><small>{group.expectedGameList.join('、')}</small></td>
                    <td><strong>{group.actualCount}</strong>{group.extraActualCount ? <small>另有 {group.extraActualCount} 个非合同清单游戏</small> : null}</td>
                    <td className={group.missingGames.length ? 'is-risk' : ''}><strong>{group.missingGames.length}</strong><small>{group.missingGames.join('、') || '—'}</small></td>
                    <td className={group.missingFlowCount ? 'is-warning' : ''}><strong>{group.missingFlowCount}</strong><small>{group.missingFlowGames.join('、') || '—'}</small></td>
                    <td><span className={hasRisk || group.pendingBills ? 'is-open' : 'is-done'}>{statusLabel}</span></td>
                    <td>{hasRisk || group.pendingBills || !group.records.length ? <button type="button" onClick={() => openGroup(group)}>{group.records.length ? '继续本月账单' : '创建本月账单'}</button> : <span className="is-done-text">✓ 已齐</span>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  )
}
