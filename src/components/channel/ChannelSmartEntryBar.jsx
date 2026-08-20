import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { initialLineItem, normalizeChannelSettlementCycle } from '@/domain/channel/channelBillingForm.js'
import {
  loadAliasMemory,
  normalizeInlineKey,
  parsePendingNotes,
  persistAliasMemory,
  rememberAlias,
  resolveAlias,
  updatePendingNote
} from '@/domain/channel/channelInlineResolution.js'
import {
  createContract,
  createContractAccessItem,
  listContracts,
  updateContractAccessItem
} from '@/lib/api/contract.ts'
import {
  listContractAccessTerms,
  upsertContractAccessTerms
} from '@/lib/api/contractTerms.ts'
import './ChannelSmartEntryBar.css'

const textKey = normalizeInlineKey

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

function samePartner(record, partnerName, channelName, aliasMemory) {
  const wanted = new Set([
    partnerName,
    resolveAlias(aliasMemory, 'channel', channelName)
  ].map(textKey).filter(Boolean))
  if (!wanted.size) return false
  const actual = [record?.partnerName, record?.channelName, record?.partner]
    .map((value) => resolveAlias(aliasMemory, 'channel', value))
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

function contractMatchesPartner(contract, partnerName, channelName, aliasMemory) {
  const wanted = new Set([
    partnerName,
    resolveAlias(aliasMemory, 'channel', channelName)
  ].map(textKey).filter(Boolean))
  if (!wanted.size) return false
  const actual = [
    contract?.partner_name,
    contract?.partner_short_name,
    contract?.counterparty
  ].map((value) => resolveAlias(aliasMemory, 'channel', value)).map(textKey).filter(Boolean)
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

function nullableValue(value) {
  const text = String(value ?? '').trim()
  return text === '' ? null : text
}

function firstNamedGame(record) {
  return String(namedLines(record)[0]?.gameName || '').trim()
}

export default function ChannelSmartEntryBar({
  record,
  channelRecords = [],
  onApply,
  onNotice
}) {
  const partnerName = String(record?.partnerName || '').trim()
  const channelName = String(record?.channelName || '').trim()
  const [aliasMemory, setAliasMemory] = useState(() => loadAliasMemory())
  const canonicalChannelName = resolveAlias(aliasMemory, 'channel', channelName)
  const partnerKey = `${textKey(partnerName)}|${textKey(canonicalChannelName)}`
  const [targetMonth, setTargetMonth] = useState(() => recordMonth(record))
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

  const [newContractOpen, setNewContractOpen] = useState(false)
  const [newContractSaving, setNewContractSaving] = useState(false)
  const [newContractName, setNewContractName] = useState('')
  const [newContractGame, setNewContractGame] = useState('')
  const [newContractStart, setNewContractStart] = useState('')
  const [newContractEnd, setNewContractEnd] = useState('')
  const [newContractShare, setNewContractShare] = useState('')
  const [newContractFee, setNewContractFee] = useState('')
  const [newContractTax, setNewContractTax] = useState('')

  const [ruleOpen, setRuleOpen] = useState(false)
  const [ruleLoading, setRuleLoading] = useState(false)
  const [ruleSaving, setRuleSaving] = useState(false)
  const [ruleGame, setRuleGame] = useState('')
  const [ruleMatch, setRuleMatch] = useState(null)
  const [ruleShare, setRuleShare] = useState('')
  const [ruleFee, setRuleFee] = useState('')
  const [ruleTax, setRuleTax] = useState('')

  const [aliasOpen, setAliasOpen] = useState(false)
  const [aliasSource, setAliasSource] = useState('')
  const [aliasTarget, setAliasTarget] = useState('')

  const [pendingOpen, setPendingOpen] = useState(false)
  const [pendingKey, setPendingKey] = useState('')
  const [pendingNote, setPendingNote] = useState('')

  const autoGenerateKeyRef = useRef('')
  const autoAliasKeyRef = useRef('')

  useEffect(() => {
    setTargetMonth(recordMonth(record))
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
      const exact = rows.filter((contract) => contractMatchesPartner(contract, partnerName, canonicalChannelName, aliasMemory))
      const selected = (exact.length ? exact : rows).filter((contract) => contract?.timeline_status !== '已过期')
      setContractState({ key: loadKey, loading: false, items: selected, error: '' })
      return selected
    } catch (error) {
      const message = error instanceof Error ? error.message : '合同合作清单读取失败'
      setContractState({ key: loadKey, loading: false, items: [], error: message })
      return []
    }
  }, [partnerName, canonicalChannelName, partnerKey, aliasMemory])

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

  const resolveGameName = useCallback((value) => resolveAlias(aliasMemory, 'game', value), [aliasMemory])

  const previousRecord = useMemo(() => {
    if (!partnerName || !targetMonth) return null
    return (channelRecords || [])
      .filter((item) => samePartner(item, partnerName, canonicalChannelName, aliasMemory))
      .map((item) => ({ record: item, month: recordMonth(item) }))
      .filter((item) => item.month && item.month < targetMonth)
      .sort((a, b) => b.month.localeCompare(a.month))[0]?.record || null
  }, [channelRecords, partnerName, canonicalChannelName, targetMonth, aliasMemory])

  const previousLines = useMemo(() => namedLines(previousRecord), [previousRecord])

  const mergedSeeds = useMemo(() => {
    const map = new Map()
    for (const item of contractGames) map.set(textKey(item.gameName), { gameName: item.gameName, previousLine: null, source: 'contract' })
    for (const line of previousLines) {
      const rawName = String(line?.gameName || '').trim()
      if (!rawName) continue
      const canonicalName = resolveGameName(rawName)
      const key = textKey(canonicalName)
      const existing = map.get(key)
      map.set(key, { gameName: existing?.gameName || canonicalName, previousLine: line, source: existing ? 'both' : 'previous' })
    }
    return [...map.values()]
  }, [contractGames, previousLines, resolveGameName])

  const contractGameKeys = useMemo(() => new Set(contractGames.map((item) => textKey(item.gameName))), [contractGames])
  const missingGames = useMemo(() => namedLines(record)
    .map((item) => String(item.gameName || '').trim())
    .filter((name) => name && !contractGameKeys.has(textKey(resolveGameName(name)))), [record, contractGameKeys, resolveGameName])

  const pendingState = useMemo(() => parsePendingNotes(record?.remark), [record?.remark])
  const pendingItems = pendingState.items

  useEffect(() => {
    const current = Array.isArray(record?.items) ? record.items : []
    let changed = false
    const changedNames = []
    const nextItems = current.map((item) => {
      const raw = String(item?.gameName || '').trim()
      if (!raw) return item
      const canonical = resolveGameName(raw)
      if (!canonical || textKey(raw) === textKey(canonical)) return item
      changed = true
      changedNames.push(`${raw}→${canonical}`)
      return { ...item, gameName: canonical }
    })
    if (!changed) return
    const key = changedNames.sort().join('|')
    if (autoAliasKeyRef.current === key) return
    autoAliasKeyRef.current = key
    onApply?.({ ...(record || {}), items: nextItems }, `已按记住的名称映射自动识别：${changedNames.join('、')}`, 'info')
  }, [record, resolveGameName, onApply])

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
      const existingKeys = new Set(existingNamed.map((item) => textKey(resolveGameName(item.gameName))))
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
  }, [partnerName, targetMonth, record, onApply, onNotice, resolveGameName])

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
    const seeds = previousLines.map((line) => ({ gameName: resolveGameName(line.gameName), previousLine: line, source: 'previous' }))
    applyGeneratedRows(seeds, { replace: true, sourceLabel: `已按 ${recordMonth(previousRecord)} 上月账单` })
  }

  const openQuickSupplement = (gameName = missingGames[0] || '') => {
    if (!contractState.items.length) {
      openQuickContract(gameName)
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
        channel_name: canonicalChannelName || partnerName,
        agreement_type: '联合运营',
        product_name: gameName,
        platform: '其他',
        language: '简体中文',
        rights_source: '授权获得',
        game_status: '上架',
        agreement_status: '已签约',
        authorization_start: quickStart || null,
        authorization_end: quickEnd || null,
        share_rate: nullableValue(quickShareRate),
        channel_fee_rate: nullableValue(quickChannelFeeRate),
        status: '生效',
        remarks: '由渠道账单快捷补充'
      })
      let termsWarning = false
      try {
        await upsertContractAccessTerms(String(accessItem.id), {
          contract_id: String(contract.id),
          currency: 'CNY',
          invoice_tax_rate: nullableValue(quickTaxRate)
        })
      } catch (error) {
        console.warn('快捷补充合同税率失败，合作清单已保存。', error)
        termsWarning = true
      }
      await loadContracts()
      setQuickOpen(false)
      onApply?.({ ...(record || {}) }, termsWarning
        ? `「${gameName}」已补入合同合作清单；税率结构化字段未写入，请稍后补充。`
        : `「${gameName}」已补入合同合作清单，当前账单将自动重新匹配合同规则。`, termsWarning ? 'info' : 'success')
    } catch (error) {
      onNotice?.(error instanceof Error ? error.message : '快捷补充合同清单失败', 'error')
    } finally {
      setQuickSaving(false)
    }
  }

  function openQuickContract(gameName = firstNamedGame(record)) {
    const line = namedLines(record).find((item) => textKey(item.gameName) === textKey(gameName)) || namedLines(record)[0]
    setNewContractName(`${partnerName || canonicalChannelName || '合作方'} · 渠道合作协议`)
    setNewContractGame(String(gameName || line?.gameName || '').trim())
    setNewContractStart(targetMonth ? `${targetMonth}-01` : '')
    setNewContractEnd('')
    setNewContractShare(line?.shareRate != null ? String(line.shareRate) : '')
    setNewContractFee(line?.channelFeeRate != null && String(line.channelFeeRate).trim() !== '' ? String(line.channelFeeRate) : String(record?.channelFeeRate ?? ''))
    setNewContractTax(line?.taxRate != null ? String(line.taxRate) : '')
    setNewContractOpen(true)
  }

  const saveQuickContract = async () => {
    const gameName = String(newContractGame || '').trim()
    if (!partnerName || !String(newContractName || '').trim() || !gameName) {
      onNotice?.('合作方、合同名称和游戏不能为空', 'error')
      return
    }
    setNewContractSaving(true)
    try {
      const contract = await createContract({
        contract_name: String(newContractName).trim(),
        contract_type: '渠道合作',
        document_type: 'master',
        counterparty: partnerName,
        effective_date: newContractStart || null,
        end_date: newContractEnd || null,
        signing_status: '已签约',
        performance_status: '履约中',
        payment_type: '分成结算',
        attachments: []
      })
      const accessItem = await createContractAccessItem(String(contract.id), {
        channel_name: canonicalChannelName || partnerName,
        agreement_type: '联合运营',
        product_name: gameName,
        platform: '其他',
        language: '简体中文',
        rights_source: '授权获得',
        game_status: '上架',
        agreement_status: '已签约',
        authorization_start: newContractStart || null,
        authorization_end: newContractEnd || null,
        share_rate: nullableValue(newContractShare),
        channel_fee_rate: nullableValue(newContractFee),
        status: '生效',
        remarks: '由渠道账单就地快速建合同'
      })
      let termsWarning = false
      try {
        await upsertContractAccessTerms(String(accessItem.id), {
          contract_id: String(contract.id),
          currency: 'CNY',
          invoice_tax_rate: nullableValue(newContractTax)
        })
      } catch (error) {
        console.warn('快速建合同的税率结构化字段写入失败。', error)
        termsWarning = true
      }
      await loadContracts()
      setNewContractOpen(false)
      onApply?.({ ...(record || {}) }, termsWarning
        ? `合同和「${gameName}」合作清单已在当前页创建；税率结构化字段需稍后补充。`
        : `合同和「${gameName}」合作清单已创建，当前账单将自动重新匹配。`, termsWarning ? 'info' : 'success')
    } catch (error) {
      onNotice?.(error instanceof Error ? error.message : '当前页快速建合同失败', 'error')
    } finally {
      setNewContractSaving(false)
    }
  }

  const contractGameFor = useCallback((gameName) => {
    const canonical = resolveGameName(gameName)
    return contractGames.find((item) => textKey(item.gameName) === textKey(canonical)) || null
  }, [contractGames, resolveGameName])

  const loadRuleEditor = useCallback(async (gameName) => {
    const rawGame = String(gameName || '').trim()
    const match = contractGameFor(rawGame)
    if (!match) {
      onNotice?.(`「${rawGame || '当前游戏'}」还没有匹配到合同合作清单，请先补清单或做名称映射。`, 'info')
      return false
    }
    const line = namedLines(record).find((item) => textKey(resolveGameName(item.gameName)) === textKey(match.gameName))
    setRuleGame(rawGame || match.gameName)
    setRuleMatch(match)
    setRuleShare(match.accessItem?.share_rate != null ? String(match.accessItem.share_rate) : String(line?.shareRate ?? ''))
    setRuleFee(match.accessItem?.channel_fee_rate != null ? String(match.accessItem.channel_fee_rate) : String(line?.channelFeeRate ?? record?.channelFeeRate ?? ''))
    setRuleTax(String(line?.taxRate ?? ''))
    setRuleOpen(true)
    setRuleLoading(true)
    try {
      const result = await listContractAccessTerms({ accessItemId: String(match.accessItem.id) })
      const terms = result?.items?.[0]
      if (terms?.invoice_tax_rate != null) setRuleTax(String(terms.invoice_tax_rate))
    } catch (error) {
      console.warn('合同结构化税率读取失败，先使用当前账单税率作为编辑初值。', error)
    } finally {
      setRuleLoading(false)
    }
    return true
  }, [contractGameFor, record, resolveGameName, onNotice])

  const openRuleEditor = () => {
    const matched = namedLines(record).find((line) => contractGameFor(line.gameName))
    if (!matched) {
      onNotice?.('当前账单还没有已匹配合同清单的游戏，请先处理缺失项。', 'info')
      return
    }
    void loadRuleEditor(matched.gameName)
  }

  const saveRuleEditor = async () => {
    if (!ruleMatch?.contract?.id || !ruleMatch?.accessItem?.id) return
    setRuleSaving(true)
    try {
      await updateContractAccessItem(String(ruleMatch.contract.id), String(ruleMatch.accessItem.id), {
        product_name: ruleMatch.accessItem.product_name || ruleMatch.gameName,
        share_rate: nullableValue(ruleShare),
        channel_fee_rate: nullableValue(ruleFee)
      })
      await upsertContractAccessTerms(String(ruleMatch.accessItem.id), {
        contract_id: String(ruleMatch.contract.id),
        currency: 'CNY',
        invoice_tax_rate: nullableValue(ruleTax)
      })
      await loadContracts()
      setRuleOpen(false)
      onApply?.({ ...(record || {}) }, `「${ruleMatch.gameName}」合同规则已更新，当前账单将自动重新匹配。`)
    } catch (error) {
      onNotice?.(error instanceof Error ? error.message : '合同规则更新失败', 'error')
    } finally {
      setRuleSaving(false)
    }
  }

  const openAliasDialog = (source = missingGames[0] || '') => {
    if (!contractGames.length) {
      onNotice?.('当前没有可映射的合同标准游戏名，请先补合同或合作清单。', 'info')
      return
    }
    setAliasSource(source)
    setAliasTarget(contractGames[0]?.gameName || '')
    setAliasOpen(true)
  }

  const saveGameAlias = () => {
    if (!aliasSource || !aliasTarget) return
    const nextMemory = rememberAlias(aliasMemory, 'game', aliasSource, aliasTarget)
    persistAliasMemory(nextMemory)
    setAliasMemory(nextMemory)
    const nextItems = (Array.isArray(record?.items) ? record.items : []).map((item) =>
      textKey(item?.gameName) === textKey(aliasSource) ? { ...item, gameName: aliasTarget } : item
    )
    setAliasOpen(false)
    onApply?.({ ...(record || {}), items: nextItems }, `已记住名称映射：${aliasSource} → ${aliasTarget}。以后当前浏览器会自动识别。`)
  }

  const rememberCurrentChannelAlias = () => {
    if (!channelName || !partnerName || textKey(channelName) === textKey(partnerName)) return
    const nextMemory = rememberAlias(aliasMemory, 'channel', channelName, partnerName)
    persistAliasMemory(nextMemory)
    setAliasMemory(nextMemory)
    onNotice?.(`已记住渠道别名：${channelName} → ${partnerName}`, 'success')
  }

  const openPendingEditor = (key = firstNamedGame(record) || '合作方合同') => {
    const existing = pendingItems.find((item) => textKey(item.key) === textKey(key))
    setPendingKey(key)
    setPendingNote(existing?.note || '')
    setPendingOpen(true)
  }

  const savePendingEditor = () => {
    if (!pendingKey || !pendingNote.trim()) {
      onNotice?.('请填写待补说明', 'error')
      return
    }
    const nextRemark = updatePendingNote(record?.remark, pendingKey, pendingNote)
    setPendingOpen(false)
    onApply?.({ ...(record || {}), remark: nextRemark }, `已挂起「${pendingKey}」待补资料，不影响继续录其他明细。`, 'info')
  }

  const clearPending = (key) => {
    const nextRemark = updatePendingNote(record?.remark, key, '')
    onApply?.({ ...(record || {}), remark: nextRemark }, `「${key}」待补资料已完成。`)
  }

  const loaded = contractState.key === partnerKey && !contractState.loading
  const sourceText = `${contractGames.length} 个合同游戏${previousLines.length ? ` · 上月 ${previousLines.length} 个` : ''}`
  const matchedLineCount = namedLines(record).filter((line) => contractGameFor(line.gameName)).length
  const channelAliasRemembered = channelName && resolveAlias(aliasMemory, 'channel', channelName) !== channelName

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
          <input type="month" max={currentMonth()} value={targetMonth} onChange={(event) => setTargetMonth(event.target.value)} />
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
          {channelName && partnerName && textKey(channelName) !== textKey(partnerName) ? (
            <button type="button" className="channel-smart-entry__text-action" disabled={channelAliasRemembered} onClick={rememberCurrentChannelAlias}>
              {channelAliasRemembered ? `已记住别名：${channelName}` : `记住渠道别名：${channelName}`}
            </button>
          ) : null}
        </div>
      </div>

      {contractState.error ? (
        <div className="channel-smart-entry__notice is-warning">
          合同清单暂时读取失败：{contractState.error}。不影响手工录入和保存待核对账单。
        </div>
      ) : null}

      {loaded && partnerName && contractState.items.length === 0 ? (
        <div className="channel-smart-entry__notice is-warning channel-smart-entry__notice--actions">
          <div>
            <strong>当前合作方没有可用合同</strong>
            <span>不用离开账单：可以在这里快速建最小合同，也可以先挂起待补资料继续做账。</span>
          </div>
          <div>
            <button type="button" className="is-primary" onClick={() => openQuickContract()}>当前页快速建合同</button>
            <button type="button" onClick={() => openPendingEditor('合作方合同')}>暂时挂起</button>
          </div>
        </div>
      ) : null}

      {missingGames.length ? (
        <div className="channel-smart-entry__missing">
          <div>
            <strong>发现 {missingGames.length} 个游戏缺少合同合作清单</strong>
            <span>补清单、映射名称、挂起待补，都在当前账单完成。</span>
          </div>
          <div className="channel-smart-entry__issue-list">
            {missingGames.map((gameName) => (
              <div className="channel-smart-entry__issue-row" key={gameName}>
                <strong>{gameName}</strong>
                <div>
                  <button type="button" onClick={() => openQuickSupplement(gameName)}>{contractState.items.length ? '补合作清单' : '建合同并补清单'}</button>
                  <button type="button" disabled={!contractGames.length} onClick={() => openAliasDialog(gameName)}>名称映射</button>
                  <button type="button" onClick={() => openPendingEditor(gameName)}>待补资料</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {partnerName && namedLines(record).length ? (
        <div className="channel-smart-entry__inline-tools">
          <div>
            <strong>就地处理</strong>
            <span>{matchedLineCount} 个游戏已匹配合同；规则不对或资料没齐都不用跳页面。</span>
          </div>
          <div>
            <button type="button" disabled={!matchedLineCount} onClick={openRuleEditor}>调整合同规则</button>
            <button type="button" onClick={() => openPendingEditor()}>挂起待补资料</button>
          </div>
        </div>
      ) : null}

      {pendingItems.length ? (
        <div className="channel-smart-entry__pending">
          <div>
            <strong>待补资料 {pendingItems.length} 项</strong>
            <span>这些事项会跟随账单备注保存；处理完可以原地关闭。</span>
          </div>
          <div className="channel-smart-entry__pending-list">
            {pendingItems.map((item) => (
              <div key={`${item.key}-${item.note}`}>
                <button type="button" onClick={() => openPendingEditor(item.key)} title={item.note}>{item.key} · {item.note}</button>
                <button type="button" className="is-done" onClick={() => clearPending(item.key)}>完成</button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {quickOpen ? (
        <div className="channel-smart-entry__mask" onMouseDown={() => !quickSaving && setQuickOpen(false)}>
          <div className="channel-smart-entry__dialog" role="dialog" aria-modal="true" aria-label="快捷补充合同合作清单" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div><span>QUICK CONTRACT ACCESS</span><h3>快捷补充合同合作清单</h3><p>保存后留在当前账单，并立即重新匹配合同规则。</p></div>
              <button type="button" disabled={quickSaving} onClick={() => setQuickOpen(false)}>×</button>
            </header>
            <div className="channel-smart-entry__dialog-grid">
              <label className="is-wide"><span>游戏</span><select value={quickGame} onChange={(event) => setQuickGame(event.target.value)}>{missingGames.map((gameName) => <option key={gameName} value={gameName}>{gameName}</option>)}</select></label>
              <label className="is-wide"><span>归属合同</span><select value={quickContractId} onChange={(event) => { const id = event.target.value; const next = contractState.items.find((item) => String(item?.id || '') === id); setQuickContractId(id); setQuickStart(next?.effective_date || (targetMonth ? `${targetMonth}-01` : '')); setQuickEnd(next?.end_date || '') }}>{contractState.items.map((contract) => <option key={contract.id} value={contract.id}>{contractLabel(contract)} · {contract.contract_name}</option>)}</select></label>
              <label><span>授权开始</span><input type="date" value={quickStart || ''} onChange={(event) => setQuickStart(event.target.value)} /></label>
              <label><span>授权结束</span><input type="date" value={quickEnd || ''} onChange={(event) => setQuickEnd(event.target.value)} /></label>
              <label><span>分成比例 %</span><input type="number" step="0.01" value={quickShareRate} onChange={(event) => setQuickShareRate(event.target.value)} placeholder="可留空" /></label>
              <label><span>通道费率 %</span><input type="number" step="0.01" value={quickChannelFeeRate} onChange={(event) => setQuickChannelFeeRate(event.target.value)} placeholder="可留空" /></label>
              <label><span>税率 %</span><input type="number" step="0.01" value={quickTaxRate} onChange={(event) => setQuickTaxRate(event.target.value)} placeholder="可留空" /></label>
            </div>
            <footer><span>只补业务清单和你确认的规则字段，不会修改当前流水金额。</span><div><button type="button" disabled={quickSaving} onClick={() => setQuickOpen(false)}>取消</button><button type="button" className="is-primary" disabled={quickSaving || !quickGame || !quickContractId} onClick={() => void saveQuickSupplement()}>{quickSaving ? '正在保存…' : '保存并应用到当前账单'}</button></div></footer>
          </div>
        </div>
      ) : null}

      {newContractOpen ? (
        <div className="channel-smart-entry__mask" onMouseDown={() => !newContractSaving && setNewContractOpen(false)}>
          <div className="channel-smart-entry__dialog" role="dialog" aria-modal="true" aria-label="当前页快速建合同" onMouseDown={(event) => event.stopPropagation()}>
            <header><div><span>INLINE CONTRACT</span><h3>当前页快速建合同</h3><p>只创建继续对账所需的最小合同信息，后续附件和详细条款仍可再完善。</p></div><button type="button" disabled={newContractSaving} onClick={() => setNewContractOpen(false)}>×</button></header>
            <div className="channel-smart-entry__dialog-grid">
              <label className="is-wide"><span>合作方</span><input value={partnerName} disabled /></label>
              <label className="is-wide"><span>合同名称</span><input value={newContractName} onChange={(event) => setNewContractName(event.target.value)} /></label>
              <label className="is-wide"><span>首个合作游戏</span><input value={newContractGame} onChange={(event) => setNewContractGame(event.target.value)} placeholder="必填" /></label>
              <label><span>生效日期</span><input type="date" value={newContractStart} onChange={(event) => setNewContractStart(event.target.value)} /></label>
              <label><span>终止日期</span><input type="date" value={newContractEnd} onChange={(event) => setNewContractEnd(event.target.value)} /></label>
              <label><span>分成比例 %</span><input type="number" step="0.01" value={newContractShare} onChange={(event) => setNewContractShare(event.target.value)} /></label>
              <label><span>通道费率 %</span><input type="number" step="0.01" value={newContractFee} onChange={(event) => setNewContractFee(event.target.value)} /></label>
              <label><span>税率 %</span><input type="number" step="0.01" value={newContractTax} onChange={(event) => setNewContractTax(event.target.value)} /></label>
            </div>
            <footer><span>创建成功后不离开账单，系统立即重新匹配。</span><div><button type="button" disabled={newContractSaving} onClick={() => setNewContractOpen(false)}>取消</button><button type="button" className="is-primary" disabled={newContractSaving || !newContractName.trim() || !newContractGame.trim()} onClick={() => void saveQuickContract()}>{newContractSaving ? '正在创建…' : '创建并继续当前账单'}</button></div></footer>
          </div>
        </div>
      ) : null}

      {ruleOpen ? (
        <div className="channel-smart-entry__mask" onMouseDown={() => !ruleSaving && setRuleOpen(false)}>
          <div className="channel-smart-entry__dialog" role="dialog" aria-modal="true" aria-label="就地调整合同规则" onMouseDown={(event) => event.stopPropagation()}>
            <header><div><span>INLINE RULE FIX</span><h3>就地调整合同规则</h3><p>修改的是该游戏对应的合同合作清单；保存后当前账单自动重新匹配。</p></div><button type="button" disabled={ruleSaving} onClick={() => setRuleOpen(false)}>×</button></header>
            <div className="channel-smart-entry__dialog-grid">
              <label className="is-wide"><span>游戏</span><select value={ruleGame} disabled={ruleLoading || ruleSaving} onChange={(event) => void loadRuleEditor(event.target.value)}>{namedLines(record).filter((line) => contractGameFor(line.gameName)).map((line) => <option key={line.gameName} value={line.gameName}>{line.gameName}</option>)}</select></label>
              <label className="is-wide"><span>对应合同</span><input value={ruleMatch ? `${contractLabel(ruleMatch.contract)} · ${ruleMatch.contract.contract_name}` : ''} disabled /></label>
              <label><span>分成比例 %</span><input type="number" step="0.01" value={ruleShare} disabled={ruleLoading} onChange={(event) => setRuleShare(event.target.value)} /></label>
              <label><span>通道费率 %</span><input type="number" step="0.01" value={ruleFee} disabled={ruleLoading} onChange={(event) => setRuleFee(event.target.value)} /></label>
              <label><span>税率 %</span><input type="number" step="0.01" value={ruleTax} disabled={ruleLoading} onChange={(event) => setRuleTax(event.target.value)} /></label>
            </div>
            <footer><span>{ruleLoading ? '正在读取合同结构化条款…' : '如果只想临时改本账单，仍可直接改下方明细；这里用于修正以后都应沿用的合同规则。'}</span><div><button type="button" disabled={ruleSaving} onClick={() => setRuleOpen(false)}>取消</button><button type="button" className="is-primary" disabled={ruleLoading || ruleSaving || !ruleMatch} onClick={() => void saveRuleEditor()}>{ruleSaving ? '正在保存…' : '更新合同规则并重匹配'}</button></div></footer>
          </div>
        </div>
      ) : null}

      {aliasOpen ? (
        <div className="channel-smart-entry__mask" onMouseDown={() => setAliasOpen(false)}>
          <div className="channel-smart-entry__dialog channel-smart-entry__dialog--compact" role="dialog" aria-modal="true" aria-label="名称映射" onMouseDown={(event) => event.stopPropagation()}>
            <header><div><span>NAME MAPPING</span><h3>名称映射</h3><p>确认一次后，本浏览器以后会把这个别名自动识别成合同标准游戏名。</p></div><button type="button" onClick={() => setAliasOpen(false)}>×</button></header>
            <div className="channel-smart-entry__dialog-grid"><label className="is-wide"><span>当前名称</span><input value={aliasSource} disabled /></label><label className="is-wide"><span>映射到合同标准名称</span><select value={aliasTarget} onChange={(event) => setAliasTarget(event.target.value)}>{contractGames.map((item) => <option key={item.gameName} value={item.gameName}>{item.gameName}</option>)}</select></label></div>
            <footer><span>不会修改历史账单，只处理当前及以后录入。</span><div><button type="button" onClick={() => setAliasOpen(false)}>取消</button><button type="button" className="is-primary" disabled={!aliasSource || !aliasTarget} onClick={saveGameAlias}>确认映射</button></div></footer>
          </div>
        </div>
      ) : null}

      {pendingOpen ? (
        <div className="channel-smart-entry__mask" onMouseDown={() => setPendingOpen(false)}>
          <div className="channel-smart-entry__dialog channel-smart-entry__dialog--compact" role="dialog" aria-modal="true" aria-label="挂起待补资料" onMouseDown={(event) => event.stopPropagation()}>
            <header><div><span>PENDING INFO</span><h3>挂起待补资料</h3><p>先记录为什么没处理完，然后继续做账；下次打开这张账单仍会看到。</p></div><button type="button" onClick={() => setPendingOpen(false)}>×</button></header>
            <div className="channel-smart-entry__dialog-grid"><label className="is-wide"><span>事项</span><select value={pendingKey} onChange={(event) => { const key = event.target.value; const existing = pendingItems.find((item) => textKey(item.key) === textKey(key)); setPendingKey(key); setPendingNote(existing?.note || '') }}><option value="合作方合同">合作方合同</option>{namedLines(record).map((line) => <option key={line.gameName} value={line.gameName}>{line.gameName}</option>)}</select></label><label className="is-wide"><span>待补说明</span><textarea rows="4" value={pendingNote} onChange={(event) => setPendingNote(event.target.value)} placeholder="例如：等商务确认8月活动扣款；合同原件明天补。" /></label></div>
            <footer><span>待补事项会写入账单备注，不会阻止你继续填写其他游戏。</span><div><button type="button" onClick={() => setPendingOpen(false)}>取消</button><button type="button" className="is-primary" disabled={!pendingKey || !pendingNote.trim()} onClick={savePendingEditor}>保存待补事项</button></div></footer>
          </div>
        </div>
      ) : null}
    </section>
  )
}
