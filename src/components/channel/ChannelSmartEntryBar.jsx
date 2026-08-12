import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { initialLineItem, normalizeChannelSettlementCycle } from '@/domain/channel/channelBillingForm.js'
import { createContractAccessItem, listContracts } from '@/lib/api/contract.ts'
import { upsertContractAccessTerms } from '@/lib/api/contractTerms.ts'
import './ChannelSmartEntryBar.css'

function textKey(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[（(]/g, '(')
    .replace(/[）)]/g, ')')
    .replace(/\s+/g, '')
}

function monthValue(value) {
  const normalized = normalizeChannelSettlementCycle(value)
  const match = String(normalized || value || '').match(/^(20\d{2})[-年/.](0?[1-9]|1[0-2])/)
  if (!match) return ''
  return `${match[1]}-${String(Number(match[2])).padStart(2, '0')}`
}

function currentMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function recordMonth(record) {
  const direct = monthValue(record?.settlementMonth)
  if (direct) return direct
  const months = (Array.isArray(record?.items) ? record.items : [])
    .map((item) => monthValue(item?.settlementCycle))
    .filter(Boolean)
    .sort()
  return months[months.length - 1] || ''
}

function samePartner(record, partnerName, channelName) {
  const wanted = new Set([partnerName, channelName].map(textKey).filter(Boolean))
  if (!wanted.size) return false
  const actual = [record?.partnerName, record?.channelName, record?.partner]
    .map(textKey)
    .filter(Boolean)
  return actual.some((value) => wanted.has(value))
}

function accessItemCoversMonth(item, targetMonth) {
  if (!targetMonth) return true
  if (['已过期', '已终止'].includes(String(item?.timeline_status || ''))) return false
  const start = monthValue(item?.authorization_start)
  const end = monthValue(item?.authorization_end)
  if (start && targetMonth < start) return false
  if (end && targetMonth > end) return false
  return true
}

function contractMatchesPartner(contract, partnerName, channelName) {
  const wanted = new Set([partnerName, channelName].map(textKey).filter(Boolean))
  if (!wanted.size) return false
  const actual = [
    contract?.partner_name,
    contract?.partner_short_name,
    contract?.counterparty
  ].map(textKey).filter(Boolean)
  return actual.some((value) => wanted.has(value))
}

function blankMonthlyAmounts(row) {
  return {
    ...row,
    flow: '',
    voucherCost: '',
    noWorryCost: '',
    refundCost: '',
    testCost: '',
    welfareCost: '',
    coinCost: '',
    gatewayCost: row?.channelFeeMode === 'fixed' ? '' : row?.gatewayCost || '',
    billingAmount: '',
    shareAmount: '',
    platformSettlementAmount: '',
    systemSettlementAmount: '',
    settlementDifference: '',
    validationStatus: 'unvalidated',
    settlementAmount: ''
  }
}

function newSmartLine(gameName, settlementMonth, previousLine = null) {
  const base = initialLineItem()
  const inherited = previousLine
    ? {
        discountFactor: previousLine.discountFactor ?? base.discountFactor,
        shareRate: previousLine.shareRate ?? base.shareRate,
        taxRate: previousLine.taxRate ?? base.taxRate,
        settlementRuleCode: previousLine.settlementRuleCode || '',
        channelFeeMode: previousLine.channelFeeMode || '',
        channelFeeRate: previousLine.channelFeeRate ?? '',
        taxMode: previousLine.taxMode || '',
        validationTolerance: previousLine.validationTolerance ?? ''
      }
    : {}
  return blankMonthlyAmounts({
    ...base,
    ...inherited,
    id: '',
    settlementCycle: settlementMonth,
    gameName
  })
}

function namedLines(record) {
  return (Array.isArray(record?.items) ? record.items : []).filter((item) => String(item?.gameName || '').trim())
}

function hasMonthlyAmounts(record) {
  return namedLines(record).some((item) => [
    item.flow,
    item.voucherCost,
    item.noWorryCost,
    item.refundCost,
    item.testCost,
    item.welfareCost,
    item.coinCost,
    item.platformSettlementAmount
  ].some((value) => value != null && String(value).trim() !== '' && Number(value) !== 0))
}

function contractLabel(contract) {
  return contract?.internal_contract_no || contract?.contract_no || contract?.contract_name || '未命名合同'
}

export default function ChannelSmartEntryBar({
  record,
  channelRecords = [],
  onApply,
  onNotice
}) {
  const partnerName = String(record?.partnerName || '').trim()
  const channelName = String(record?.channelName || '').trim()
  const partnerKey = `${textKey(partnerName)}|${textKey(channelName)}`
  const [targetMonth, setTargetMonth] = useState(() => recordMonth(record) || currentMonth())
  const [contractState, setContractState] = useState({ key: '', loading: false, items: [], error: '' })
  const [quickOpen, setQuickOpen] = useState(false)
  const [quickSaving, setQuickSaving] = useState(false)
  const [quickGame, setQuickGame] = useState('')
  const [quickContractId, setQuickContractId] = useState('')
  const [quickShareRate, setQuickShareRate] = useState('')
  const [quickChannelFeeRate, setQuickChannelFeeRate] = useState('')
  const [quickTaxRate, setQuickTaxRate] = useState('')
  const [quickStart, setQuickStart] = useState('')
  const [quickEnd, setQuickEnd] = useState('')
  const autoGenerateKeyRef = useRef('')

  useEffect(() => {
    const fromRecord = recordMonth(record)
    if (fromRecord) setTargetMonth(fromRecord)
  }, [record?.settlementMonth, record?.items])

  const loadContracts = useCallback(async () => {
    if (!partnerName) {
      setContractState({ key: '', loading: false, items: [], error: '' })
      return []
    }
    const loadKey = partnerKey
    setContractState((current) => ({ ...current, key: loadKey, loading: true, error: '' }))
    try {
      const result = await listContracts({ q: partnerName, limit: 100, offset: 0 })
      const rows = Array.isArray(result?.items) ? result.items : []
      const exact = rows.filter((contract) => contractMatchesPartner(contract, partnerName, channelName))
      const selected = (exact.length ? exact : rows).filter((contract) => contract?.timeline_status !== '已过期')
      setContractState({ key: loadKey, loading: false, items: selected, error: '' })
      return selected
    } catch (error) {
      const message = error instanceof Error ? error.message : '合同合作清单读取失败'
      setContractState({ key: loadKey, loading: false, items: [], error: message })
      return []
    }
  }, [partnerName, channelName, partnerKey])

  useEffect(() => {
    void loadContracts()
  }, [loadContracts])

  const contractGames = useMemo(() => {
    const map = new Map()
    for (const contract of contractState.items || []) {
      for (const item of contract?.access_items || []) {
        const name = String(item?.product_name || '').trim()
        if (!name || !accessItemCoversMonth(item, targetMonth)) continue
        const key = textKey(name)
        if (!map.has(key)) map.set(key, { gameName: name, contract, accessItem: item })
      }
    }
    return [...map.values()]
  }, [contractState.items, targetMonth])

  const previousRecord = useMemo(() => {
    if (!partnerName || !targetMonth) return null
    return (channelRecords || [])
      .filter((item) => samePartner(item, partnerName, channelName))
      .map((item) => ({ record: item, month: recordMonth(item) }))
      .filter((item) => item.month && item.month < targetMonth)
      .sort((a, b) => b.month.localeCompare(a.month))[0]?.record || null
  }, [channelRecords, partnerName, channelName, targetMonth])

  const previousLines = useMemo(() => namedLines(previousRecord), [previousRecord])

  const mergedSeeds = useMemo(() => {
    const map = new Map()
    for (const item of contractGames) map.set(textKey(item.gameName), { gameName: item.gameName, previousLine: null, source: 'contract' })
    for (const line of previousLines) {
      const name = String(line?.gameName || '').trim()
      if (!name) continue
      const key = textKey(name)
      const existing = map.get(key)
      map.set(key, { gameName: existing?.gameName || name, previousLine: line, source: existing ? 'both' : 'previous' })
    }
    return [...map.values()]
  }, [contractGames, previousLines])

  const contractGameKeys = useMemo(() => new Set(contractGames.map((item) => textKey(item.gameName))), [contractGames])
  const missingGames = useMemo(() => namedLines(record)
    .map((item) => String(item.gameName || '').trim())
    .filter((name) => name && !contractGameKeys.has(textKey(name))), [record, contractGameKeys])

  const applyGeneratedRows = useCallback((seeds, { replace = false, sourceLabel = '合同/上月' } = {}) => {
    if (!partnerName) {
      onNotice?.('请先选择合作方', 'error')
      return false
    }
    if (!targetMonth) {
      onNotice?.('请先选择账单月份', 'error')
      return false
    }
    if (!seeds.length) {
      onNotice?.('没有找到可生成的游戏清单；可先手工新增游戏，缺合同清单时再快捷补充。', 'info')
      return false
    }

    const current = Array.isArray(record?.items) ? record.items : []
    let nextLines
    if (replace) {
      nextLines = seeds.map((seed) => newSmartLine(seed.gameName, targetMonth, seed.previousLine))
    } else {
      const existingNamed = current.filter((item) => String(item?.gameName || '').trim())
      const existingKeys = new Set(existingNamed.map((item) => textKey(item.gameName)))
      const added = seeds
        .filter((seed) => !existingKeys.has(textKey(seed.gameName)))
        .map((seed) => newSmartLine(seed.gameName, targetMonth, seed.previousLine))
      nextLines = [...existingNamed, ...added]
      if (!nextLines.length) nextLines = [newSmartLine('', targetMonth)]
    }

    const nextRecord = {
      ...(record || {}),
      settlementMonth: targetMonth,
      items: nextLines.map((item) => ({
        ...item,
        settlementCycle: item.settlementCycle || targetMonth
      }))
    }
    onApply?.(nextRecord, `${sourceLabel}已生成 ${nextLines.filter((item) => item.gameName).length} 个游戏；充值/流水金额仍全部手工填写。`)
    return true
  }, [partnerName, targetMonth, record, onApply, onNotice])

  useEffect(() => {
    if (!partnerName || !targetMonth || contractState.key !== partnerKey || contractState.loading) return
    if (namedLines(record).length > 0 || mergedSeeds.length === 0) return
    const key = `${partnerKey}|${targetMonth}|${mergedSeeds.map((item) => textKey(item.gameName)).sort().join(',')}`
    if (autoGenerateKeyRef.current === key) return
    autoGenerateKeyRef.current = key
    applyGeneratedRows(mergedSeeds, { replace: true, sourceLabel: '游戏清单' })
  }, [partnerName, targetMonth, contractState.key, contractState.loading, partnerKey, record, mergedSeeds, applyGeneratedRows])

  const generateAll = () => applyGeneratedRows(mergedSeeds, { replace: false, sourceLabel: '游戏清单' })

  const generateFromPrevious = () => {
    if (!previousLines.length) {
      onNotice?.('没有找到这个渠道更早月份的账单', 'info')
      return
    }
    if (hasMonthlyAmounts(record)) {
      const confirmed = window.confirm('当前账单已经填写了流水或扣减金额。\n\n从上月生成会清空本月流水、代金券、退款等金额，只保留游戏及规则。是否继续？')
      if (!confirmed) return
    }
    const seeds = previousLines.map((line) => ({ gameName: line.gameName, previousLine: line, source: 'previous' }))
    applyGeneratedRows(seeds, { replace: true, sourceLabel: `已按 ${recordMonth(previousRecord)} 上月账单` })
  }

  const openQuickSupplement = (gameName = missingGames[0] || '') => {
    if (!contractState.items.length) {
      onNotice?.('当前合作方还没有可补充的合同。可以先保存这张待核对账单，再到合同台账补合同。', 'info')
      return
    }
    const line = namedLines(record).find((item) => textKey(item.gameName) === textKey(gameName))
    const ranked = [...contractState.items].sort((left, right) => (right?.access_items?.length || 0) - (left?.access_items?.length || 0))
    const contract = ranked[0]
    setQuickGame(gameName)
    setQuickContractId(String(contract?.id || ''))
    setQuickShareRate(line?.shareRate != null ? String(line.shareRate) : '')
    setQuickChannelFeeRate(line?.channelFeeRate != null && String(line.channelFeeRate).trim() !== ''
      ? String(line.channelFeeRate)
      : String(record?.channelFeeRate ?? ''))
    setQuickTaxRate(line?.taxRate != null ? String(line.taxRate) : '')
    setQuickStart(contract?.effective_date || (targetMonth ? `${targetMonth}-01` : ''))
    setQuickEnd(contract?.end_date || '')
    setQuickOpen(true)
  }

  const saveQuickSupplement = async () => {
    const gameName = String(quickGame || '').trim()
    const contract = contractState.items.find((item) => String(item?.id || '') === String(quickContractId))
    if (!gameName || !contract) {
      onNotice?.('请选择要补充的游戏和合同', 'error')
      return
    }
    setQuickSaving(true)
    try {
      const accessItem = await createContractAccessItem(String(contract.id), {
        channel_name: channelName || partnerName,
        agreement_type: '联合运营',
        product_name: gameName,
        platform: '其他',
        language: '简体中文',
        rights_source: '授权获得',
        game_status: '上架',
        agreement_status: '已签约',
        authorization_start: quickStart || null,
        authorization_end: quickEnd || null,
        share_rate: String(quickShareRate).trim() === '' ? null : quickShareRate,
        channel_fee_rate: String(quickChannelFeeRate).trim() === '' ? null : quickChannelFeeRate,
        status: '生效',
        remarks: '由渠道账单快捷补充'
      })
      let termsWarning = false
      if (String(quickTaxRate).trim() !== '') {
        try {
          await upsertContractAccessTerms(String(accessItem.id), {
            contract_id: String(contract.id),
            currency: 'CNY',
            invoice_tax_rate: quickTaxRate
          })
        } catch (error) {
          console.warn('快捷补充合同税率失败，合作清单已保存。', error)
          termsWarning = true
        }
      }
      await loadContracts()
      setQuickOpen(false)
      onApply?.({ ...(record || {}) }, termsWarning
        ? `「${gameName}」已补入合同合作清单；税率结构化字段未写入，请稍后在合同台账补充。`
        : `「${gameName}」已补入合同合作清单，当前账单将自动重新匹配合同规则。`, termsWarning ? 'info' : 'success')
    } catch (error) {
      onNotice?.(error instanceof Error ? error.message : '快捷补充合同清单失败', 'error')
    } finally {
      setQuickSaving(false)
    }
  }

  const loaded = contractState.key === partnerKey && !contractState.loading
  const sourceText = `${contractGames.length} 个合同游戏${previousLines.length ? ` · 上月 ${previousLines.length} 个` : ''}`

  return (
    <section className="channel-smart-entry" aria-label="渠道账单智能录入">
      <div className="channel-smart-entry__head">
        <div>
          <span>V3.2 · 智能账单录入</span>
          <strong>选渠道、补月份，系统准备游戏清单和合同规则</strong>
          <small>充值/后台流水不读取数据库、不自动写入，仍由你手工填写。</small>
        </div>
        <em>流水手填</em>
      </div>

      <div className="channel-smart-entry__controls">
        <label>
          <span>本次账单月份</span>
          <input type="month" value={targetMonth} onChange={(event) => setTargetMonth(event.target.value)} />
        </label>
        <div className="channel-smart-entry__actions">
          <button type="button" className="is-primary" disabled={!partnerName || !targetMonth || !loaded} onClick={generateAll}>
            {contractState.loading ? '正在读合同…' : '生成 / 补齐游戏清单'}
          </button>
          <button type="button" disabled={!partnerName || !targetMonth || !previousLines.length} onClick={generateFromPrevious}>
            从上月生成
          </button>
        </div>
        <div className="channel-smart-entry__source">
          <strong>{partnerName || '先选择合作方'}</strong>
          <span>{partnerName ? (contractState.loading ? '正在读取合同合作清单…' : sourceText) : '选择合作方后自动读取清单'}</span>
        </div>
      </div>

      {contractState.error ? (
        <div className="channel-smart-entry__notice is-warning">
          合同清单暂时读取失败：{contractState.error}。不影响手工录入和保存待核对账单。
        </div>
      ) : null}

      {loaded && partnerName && contractState.items.length === 0 ? (
        <div className="channel-smart-entry__notice is-warning">
          当前合作方没有可用合同。你仍可先录账并保存，后续补合同后再核对。
        </div>
      ) : null}

      {missingGames.length ? (
        <div className="channel-smart-entry__missing">
          <div>
            <strong>发现 {missingGames.length} 个游戏缺少合同合作清单</strong>
            <span>不用离开当前账单，点游戏即可补入合同。</span>
          </div>
          <div className="channel-smart-entry__chips">
            {missingGames.map((gameName) => (
              <button type="button" key={gameName} onClick={() => openQuickSupplement(gameName)}>
                {gameName} · 快捷补充
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {quickOpen ? (
        <div className="channel-smart-entry__mask" onMouseDown={() => !quickSaving && setQuickOpen(false)}>
          <div className="channel-smart-entry__dialog" role="dialog" aria-modal="true" aria-label="快捷补充合同合作清单" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <span>QUICK CONTRACT ACCESS</span>
                <h3>快捷补充合同合作清单</h3>
                <p>保存后留在当前账单，并立即重新匹配合同规则。</p>
              </div>
              <button type="button" disabled={quickSaving} onClick={() => setQuickOpen(false)}>×</button>
            </header>
            <div className="channel-smart-entry__dialog-grid">
              <label className="is-wide">
                <span>游戏</span>
                <select value={quickGame} onChange={(event) => setQuickGame(event.target.value)}>
                  {missingGames.map((gameName) => <option key={gameName} value={gameName}>{gameName}</option>)}
                </select>
              </label>
              <label className="is-wide">
                <span>归属合同</span>
                <select value={quickContractId} onChange={(event) => {
                  const id = event.target.value
                  const next = contractState.items.find((item) => String(item?.id || '') === id)
                  setQuickContractId(id)
                  setQuickStart(next?.effective_date || (targetMonth ? `${targetMonth}-01` : ''))
                  setQuickEnd(next?.end_date || '')
                }}>
                  {contractState.items.map((contract) => (
                    <option key={contract.id} value={contract.id}>{contractLabel(contract)} · {contract.contract_name}</option>
                  ))}
                </select>
              </label>
              <label><span>授权开始</span><input type="date" value={quickStart || ''} onChange={(event) => setQuickStart(event.target.value)} /></label>
              <label><span>授权结束</span><input type="date" value={quickEnd || ''} onChange={(event) => setQuickEnd(event.target.value)} /></label>
              <label><span>分成比例 %</span><input type="number" step="0.01" value={quickShareRate} onChange={(event) => setQuickShareRate(event.target.value)} placeholder="可留空" /></label>
              <label><span>通道费率 %</span><input type="number" step="0.01" value={quickChannelFeeRate} onChange={(event) => setQuickChannelFeeRate(event.target.value)} placeholder="可留空" /></label>
              <label><span>税率 %</span><input type="number" step="0.01" value={quickTaxRate} onChange={(event) => setQuickTaxRate(event.target.value)} placeholder="可留空" /></label>
            </div>
            <footer>
              <span>只补业务清单和你确认的规则字段，不会修改当前流水金额。</span>
              <div>
                <button type="button" disabled={quickSaving} onClick={() => setQuickOpen(false)}>取消</button>
                <button type="button" className="is-primary" disabled={quickSaving || !quickGame || !quickContractId} onClick={() => void saveQuickSupplement()}>
                  {quickSaving ? '正在保存…' : '保存并应用到当前账单'}
                </button>
              </div>
            </footer>
          </div>
        </div>
      ) : null}
    </section>
  )
}
