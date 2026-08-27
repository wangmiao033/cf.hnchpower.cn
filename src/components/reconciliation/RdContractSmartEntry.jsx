import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createContractAccessItem, listContracts } from '@/lib/api/contract.ts'
import { upsertContractAccessTerms } from '@/lib/api/contractTerms.ts'
import '@/components/channel/ChannelSmartEntryBar.css'

function text(value) {
  return String(value ?? '').trim()
}

function companyKey(value) {
  return text(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s()（）·,，.。\-_/\\]/g, '')
    .replace(/(?:股份有限公司|有限责任公司|有限公司)$/u, '')
}

function gameKey(value) {
  return text(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s·,，.。\-_/\\:：]/g, '')
}

function baseGameKey(value) {
  return text(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[（(][^（）()]{0,60}[）)]/g, '')
    .replace(/[\s·,，.。\-_/\\:：]/g, '')
}

function monthValue(value) {
  const raw = text(value)
  let match = raw.match(/^(20\d{2})-(1[0-2]|0?[1-9])$/)
  if (match) return `${match[1]}-${String(Number(match[2])).padStart(2, '0')}`
  match = raw.match(/^(20\d{2})年(1[0-2]|0?[1-9])月$/)
  if (match) return `${match[1]}-${String(Number(match[2])).padStart(2, '0')}`
  match = raw.match(/^(20\d{2})[/.](1[0-2]|0?[1-9])$/)
  if (match) return `${match[1]}-${String(Number(match[2])).padStart(2, '0')}`
  return ''
}

function monthLabel(value) {
  const normalized = monthValue(value)
  if (!normalized) return text(value)
  const [year, month] = normalized.split('-')
  return `${year}年${Number(month)}月`
}

function monthFirstDay(value) {
  const normalized = monthValue(value)
  return normalized ? `${normalized}-01` : ''
}

function monthLastDay(value) {
  const normalized = monthValue(value)
  if (!normalized) return ''
  const [year, month] = normalized.split('-').map(Number)
  return `${normalized}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`
}

function coversMonth(item, contract, month) {
  const start = text(item?.authorization_start || contract?.effective_date)
  const end = text(item?.authorization_end || contract?.end_date)
  const monthStart = monthFirstDay(month)
  const monthEnd = monthLastDay(month)
  if (!monthStart || !monthEnd) return true
  if (start && start > monthEnd) return false
  if (end && end < monthStart) return false
  if (['已终止', '终止'].includes(text(item?.status))) return false
  return true
}

function contractLabel(contract) {
  return text(contract?.internal_contract_no) || text(contract?.contract_no) || text(contract?.contract_name) || '未命名合同'
}

function partnerMeta(partners, partnerId, partnerName) {
  const byId = (partners || []).find((item) => text(item?.id) === text(partnerId))
  if (byId) {
    return {
      id: text(byId.id),
      name: text(byId.name || partnerName),
      shortName: text(byId.shortName || byId.short_name || byId.tag2 || byId.tag)
    }
  }
  const target = companyKey(partnerName)
  const byName = (partners || []).find((item) => companyKey(item?.name) === target)
  return {
    id: text(byName?.id || partnerId),
    name: text(byName?.name || partnerName),
    shortName: text(byName?.shortName || byName?.short_name || byName?.tag2 || byName?.tag)
  }
}

function contractMatchesPartner(contract, meta) {
  if (meta.id && text(contract?.partner_id) === meta.id) return true
  const targets = [meta.name, meta.shortName].map(companyKey).filter(Boolean)
  if (!targets.length) return false
  const candidates = [contract?.partner_name, contract?.partner_short_name, contract?.counterparty]
    .map(companyKey)
    .filter(Boolean)
  return targets.some((target) => candidates.some((candidate) => (
    target === candidate || (Math.min(target.length, candidate.length) >= 5 && (target.includes(candidate) || candidate.includes(target)))
  )))
}

function namedLines(record) {
  return (Array.isArray(record?.items) ? record.items : []).filter((line) => text(line?.gameName))
}

function nullableNumber(value) {
  const raw = text(value).replace('%', '')
  if (!raw) return null
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : null
}

export default function RdContractSmartEntry({
  record,
  partners = [],
  onApply,
  onNotice,
  onSourceChanged
}) {
  const partnerName = text(record?.partner)
  const partnerId = text(record?.partnerId)
  const lines = namedLines(record)
  const targetMonth = monthValue(lines[0]?.settlementCycle || record?.settlementMonth)
  const meta = useMemo(
    () => partnerMeta(partners, partnerId, partnerName),
    [partners, partnerId, partnerName]
  )
  const partnerKey = `${meta.id}|${meta.name}|${meta.shortName}`

  const [state, setState] = useState({ key: '', loading: false, items: [], error: '' })
  const [mapOpen, setMapOpen] = useState(false)
  const [mapGame, setMapGame] = useState('')
  const [mapAccessId, setMapAccessId] = useState('')
  const [quickOpen, setQuickOpen] = useState(false)
  const [quickGame, setQuickGame] = useState('')
  const [quickContractId, setQuickContractId] = useState('')
  const [quickStart, setQuickStart] = useState('')
  const [quickEnd, setQuickEnd] = useState('')
  const [quickShare, setQuickShare] = useState('')
  const [quickFee, setQuickFee] = useState('')
  const [quickTax, setQuickTax] = useState('')
  const [quickTestingFee, setQuickTestingFee] = useState('')
  const [quickSaving, setQuickSaving] = useState(false)
  const sourceSignatureRef = useRef('')

  const loadContracts = useCallback(async () => {
    if (!partnerName) {
      setState({ key: partnerKey, loading: false, items: [], error: '' })
      return []
    }
    const key = `${partnerKey}|${targetMonth}`
    setState((current) => ({ ...current, key, loading: true, error: '' }))
    try {
      const collected = new Map()
      const queries = [...new Set([meta.shortName, meta.name, partnerName].map(text).filter(Boolean))]
      for (const q of queries.slice(0, 2)) {
        const result = await listContracts({ q, limit: 200, offset: 0 })
        for (const contract of result?.items || []) collected.set(String(contract.id), contract)
      }

      let rows = [...collected.values()]
      let exact = rows.filter((contract) => contractMatchesPartner(contract, meta))
      if (!exact.length && meta.id) {
        const all = await listContracts({ limit: 1000, offset: 0 })
        exact = (all?.items || []).filter((contract) => text(contract?.partner_id) === meta.id)
        for (const contract of exact) collected.set(String(contract.id), contract)
        rows = [...collected.values()]
      }
      const selected = exact.length ? exact : rows.filter((contract) => contractMatchesPartner(contract, meta))
      const finalItems = selected.length ? selected : rows
      setState({ key, loading: false, items: finalItems, error: '' })
      return finalItems
    } catch (error) {
      const message = error instanceof Error ? error.message : '研发合同读取失败'
      setState({ key, loading: false, items: [], error: message })
      return []
    }
  }, [meta.id, meta.name, meta.shortName, partnerKey, partnerName, targetMonth])

  useEffect(() => {
    void loadContracts()
  }, [loadContracts])

  const contractGames = useMemo(() => {
    const out = []
    for (const contract of state.items || []) {
      for (const accessItem of contract?.access_items || []) {
        if (!text(accessItem?.product_name)) continue
        if (!coversMonth(accessItem, contract, targetMonth)) continue
        out.push({ contract, accessItem })
      }
    }
    out.sort((left, right) => {
      const leftChannel = text(left.accessItem?.channel_name) ? 1 : 0
      const rightChannel = text(right.accessItem?.channel_name) ? 1 : 0
      if (leftChannel !== rightChannel) return leftChannel - rightChannel
      return text(left.accessItem?.product_name).localeCompare(text(right.accessItem?.product_name), 'zh-CN')
    })
    return out
  }, [state.items, targetMonth])

  const lineMatches = useMemo(() => lines.map((line) => {
    const exact = contractGames.filter(({ accessItem }) => gameKey(accessItem.product_name) === gameKey(line.gameName))
    if (exact.length === 1) return { line, pair: exact[0], mode: 'exact' }
    if (exact.length > 1) return { line, pair: exact[0], mode: 'multiple' }
    const base = contractGames.filter(({ accessItem }) => baseGameKey(accessItem.product_name) === baseGameKey(line.gameName))
    if (base.length === 1) return { line, pair: base[0], mode: 'base' }
    return { line, pair: null, mode: base.length > 1 ? 'ambiguous' : 'none' }
  }), [contractGames, lines])

  const missingGames = lineMatches.filter((item) => !item.pair).map((item) => text(item.line.gameName))
  const matchedCount = lineMatches.filter((item) => item.pair).length
  const loaded = state.key === `${partnerKey}|${targetMonth}` && !state.loading

  const sourceSignature = useMemo(() => {
    if (!loaded || !partnerName) return ''
    return [
      partnerKey,
      targetMonth,
      ...contractGames.map(({ contract, accessItem }) => `${contract.id}:${accessItem.id}:${accessItem.updated_at || ''}`)
    ].join('|')
  }, [contractGames, loaded, partnerKey, partnerName, targetMonth])

  useEffect(() => {
    if (!sourceSignature || sourceSignatureRef.current === sourceSignature) return
    sourceSignatureRef.current = sourceSignature
    onSourceChanged?.()
  }, [onSourceChanged, sourceSignature])

  const openMap = (gameName) => {
    const raw = text(gameName)
    setMapGame(raw)
    const baseMatches = contractGames.filter(({ accessItem }) => baseGameKey(accessItem.product_name) === baseGameKey(raw))
    setMapAccessId(String((baseMatches[0] || contractGames[0])?.accessItem?.id || ''))
    setMapOpen(true)
  }

  const applyMap = () => {
    const pair = contractGames.find(({ accessItem }) => String(accessItem.id) === String(mapAccessId))
    if (!pair || !mapGame) return
    const currentItems = Array.isArray(record?.items) ? record.items : []
    const nextItems = currentItems.map((line) => (
      text(line?.gameName) === mapGame
        ? { ...line, gameName: text(pair.accessItem.product_name) }
        : line
    ))
    setMapOpen(false)
    onApply?.(
      { ...(record || {}), items: nextItems },
      `已按研发合同标准游戏名匹配：${mapGame} → ${pair.accessItem.product_name}`,
      'success'
    )
  }

  const openQuickSupplement = (gameName) => {
    const raw = text(gameName)
    const contract = state.items[0]
    setQuickGame(raw)
    setQuickContractId(String(contract?.id || ''))
    setQuickStart(contract?.effective_date || monthFirstDay(targetMonth))
    setQuickEnd(contract?.end_date || '')
    setQuickShare('')
    setQuickFee('')
    setQuickTax('')
    setQuickTestingFee('')
    setQuickOpen(true)
  }

  const saveQuickSupplement = async () => {
    const gameName = text(quickGame)
    const contract = state.items.find((item) => String(item?.id) === String(quickContractId))
    if (!gameName || !contract) {
      onNotice?.('请选择游戏和归属研发合同', 'error')
      return
    }
    setQuickSaving(true)
    try {
      const accessItem = await createContractAccessItem(String(contract.id), {
        channel_name: '',
        agreement_type: '研发合作',
        product_name: gameName,
        authorization_start: quickStart || null,
        authorization_end: quickEnd || null,
        share_rate: nullableNumber(quickShare),
        channel_fee_rate: nullableNumber(quickFee),
        status: '生效',
        remarks: '由研发账单就地补充合同合作清单'
      })
      let termsWarning = false
      if (text(quickTax) || text(quickTestingFee)) {
        try {
          await upsertContractAccessTerms(String(accessItem.id), {
            contract_id: String(contract.id),
            currency: 'CNY',
            invoice_tax_rate: nullableNumber(quickTax),
            testing_fee: nullableNumber(quickTestingFee)
          })
        } catch (error) {
          console.warn('研发合同结构化税率/测试费写入失败，合作清单已保存。', error)
          termsWarning = true
        }
      }
      await loadContracts()
      setQuickOpen(false)
      onSourceChanged?.()
      onNotice?.(
        termsWarning
          ? `「${gameName}」已补入研发合同合作清单；税率/测试费字段请稍后补充。`
          : `「${gameName}」已补入研发合同合作清单，当前账单正在重新匹配合同规则。`,
        termsWarning ? 'info' : 'success'
      )
    } catch (error) {
      onNotice?.(error instanceof Error ? error.message : '补充研发合同合作清单失败', 'error')
    } finally {
      setQuickSaving(false)
    }
  }

  const addContractGame = (accessItemId) => {
    const pair = contractGames.find(({ accessItem }) => String(accessItem.id) === String(accessItemId))
    if (!pair) return
    const currentItems = Array.isArray(record?.items) ? record.items : []
    const cycle = monthLabel(targetMonth || record?.settlementMonth)
    const baseLine = {
      id: `contract-${Date.now()}`,
      settlementCycle: cycle,
      gameName: text(pair.accessItem.product_name),
      revenue: '0',
      discountRate: '1',
      couponAmount: '0',
      testFee: '0',
      extraFee: '0',
      shareRatio: pair.accessItem.share_rate != null ? String(pair.accessItem.share_rate) : '15',
      taxRate: '0',
      sortOrder: 0
    }
    const firstBlank = currentItems.findIndex((line) => !text(line?.gameName))
    const nextItems = [...currentItems]
    if (firstBlank >= 0) nextItems[firstBlank] = { ...nextItems[firstBlank], ...baseLine, id: nextItems[firstBlank]?.id || baseLine.id, sortOrder: firstBlank }
    else nextItems.push({ ...baseLine, sortOrder: nextItems.length })
    onApply?.({ ...(record || {}), items: nextItems }, `已从研发合同加入游戏「${pair.accessItem.product_name}」；流水仍需手工填写。`, 'success')
  }

  const [newGameAccessId, setNewGameAccessId] = useState('')
  useEffect(() => {
    if (newGameAccessId && contractGames.some(({ accessItem }) => String(accessItem.id) === String(newGameAccessId))) return
    setNewGameAccessId(String(contractGames[0]?.accessItem?.id || ''))
  }, [contractGames, newGameAccessId])

  return (
    <section className="channel-smart-entry" aria-label="研发合同优先录入">
      <div className="channel-smart-entry__head">
        <div>
          <span>CONTRACT FIRST · 研发合同优先</span>
          <strong>先读取研发合同，再按游戏和账期带入结算规则</strong>
          <small>后台流水仍以账单为准手工录入；合同只负责游戏身份、分成、税率、测试费和结算规则。</small>
        </div>
        <em>合同先行</em>
      </div>

      <div className="channel-smart-entry__controls">
        <label>
          <span>当前账期</span>
          <input type="month" value={targetMonth} disabled />
        </label>
        <div className="channel-smart-entry__actions">
          <button type="button" className="is-primary" disabled={!partnerName || state.loading} onClick={() => void loadContracts()}>
            {state.loading ? '正在读取研发合同…' : '重新读取研发合同'}
          </button>
          {!lines.length && contractGames.length ? (
            <>
              <select value={newGameAccessId} onChange={(event) => setNewGameAccessId(event.target.value)}>
                {contractGames.map(({ contract, accessItem }) => (
                  <option key={accessItem.id} value={accessItem.id}>{accessItem.product_name} · {contractLabel(contract)}</option>
                ))}
              </select>
              <button type="button" onClick={() => addContractGame(newGameAccessId)}>从合同加入游戏</button>
            </>
          ) : null}
        </div>
        <div className="channel-smart-entry__source">
          <strong>{partnerName || '先选择研发合作方'}</strong>
          <span>
            {!partnerName
              ? '选择合作方后自动读取该客户的研发合同'
              : state.loading
                ? '正在按客户读取合同及合作清单…'
                : `${state.items.length} 份合同 · ${contractGames.length} 个账期内合作游戏`}
          </span>
        </div>
      </div>

      {state.error ? (
        <div className="channel-smart-entry__notice is-warning">
          研发合同读取失败：{state.error}。账单仍可手工录入，但确认核对前建议重新读取合同。
        </div>
      ) : null}

      {loaded && partnerName && state.items.length === 0 ? (
        <div className="channel-smart-entry__notice is-warning channel-smart-entry__notice--actions">
          <div>
            <strong>当前研发商没有找到已关联合同</strong>
            <span>请先在「合同与客户」补齐研发合同或客户关联；这里不会用其他客户的合同兜底。</span>
          </div>
        </div>
      ) : null}

      {loaded && partnerName && state.items.length > 0 ? (
        <div className="channel-smart-entry__inline-tools">
          <div>
            <strong>研发合同已读取</strong>
            <span>
              {lines.length
                ? `${matchedCount}/${lines.length} 个账单游戏已在合同合作清单中定位${targetMonth ? ` · ${monthLabel(targetMonth)}` : ''}`
                : `已准备 ${contractGames.length} 个可选合作游戏${targetMonth ? ` · ${monthLabel(targetMonth)}` : ''}`}
            </span>
          </div>
          <div>
            {matchedCount === lines.length && lines.length ? <button type="button" disabled>合同来源已定位</button> : null}
          </div>
        </div>
      ) : null}

      {missingGames.length && state.items.length ? (
        <div className="channel-smart-entry__missing">
          <div>
            <strong>发现 {missingGames.length} 个游戏还没在研发合同中定位</strong>
            <span>先处理合同来源，再让下方合同规则进行金额核验。</span>
          </div>
          <div className="channel-smart-entry__issue-list">
            {missingGames.map((gameName) => (
              <div className="channel-smart-entry__issue-row" key={gameName}>
                <strong>{gameName}</strong>
                <div>
                  <button type="button" disabled={!contractGames.length} onClick={() => openMap(gameName)}>按合同名称匹配</button>
                  <button type="button" onClick={() => openQuickSupplement(gameName)}>补合同合作清单</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {mapOpen ? (
        <div className="channel-smart-entry__mask" onMouseDown={() => setMapOpen(false)}>
          <div className="channel-smart-entry__dialog channel-smart-entry__dialog--compact" role="dialog" aria-modal="true" aria-label="研发合同游戏名称匹配" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div><span>CONTRACT GAME MAP</span><h3>按研发合同标准名匹配</h3><p>只修改当前账单的游戏名称，不改后台流水。</p></div>
              <button type="button" onClick={() => setMapOpen(false)}>×</button>
            </header>
            <div className="channel-smart-entry__dialog-grid">
              <label className="is-wide"><span>账单游戏</span><input value={mapGame} disabled /></label>
              <label className="is-wide"><span>研发合同合作游戏</span><select value={mapAccessId} onChange={(event) => setMapAccessId(event.target.value)}>{contractGames.map(({ contract, accessItem }) => <option key={accessItem.id} value={accessItem.id}>{accessItem.product_name} · {contractLabel(contract)}</option>)}</select></label>
            </div>
            <footer><span>匹配后，下方会立即重新按该合同游戏进行规则核验。</span><div><button type="button" onClick={() => setMapOpen(false)}>取消</button><button type="button" className="is-primary" disabled={!mapAccessId} onClick={applyMap}>应用合同名称</button></div></footer>
          </div>
        </div>
      ) : null}

      {quickOpen ? (
        <div className="channel-smart-entry__mask" onMouseDown={() => !quickSaving && setQuickOpen(false)}>
          <div className="channel-smart-entry__dialog" role="dialog" aria-modal="true" aria-label="补充研发合同合作清单" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div><span>R&D CONTRACT ACCESS</span><h3>补充研发合同合作清单</h3><p>保存到研发合同后留在当前账单，并立即重新匹配。</p></div>
              <button type="button" disabled={quickSaving} onClick={() => setQuickOpen(false)}>×</button>
            </header>
            <div className="channel-smart-entry__dialog-grid">
              <label className="is-wide"><span>游戏</span><input value={quickGame} onChange={(event) => setQuickGame(event.target.value)} /></label>
              <label className="is-wide"><span>归属研发合同</span><select value={quickContractId} onChange={(event) => { const id = event.target.value; const next = state.items.find((item) => String(item.id) === id); setQuickContractId(id); setQuickStart(next?.effective_date || monthFirstDay(targetMonth)); setQuickEnd(next?.end_date || '') }}>{state.items.map((contract) => <option key={contract.id} value={contract.id}>{contractLabel(contract)} · {contract.contract_name}</option>)}</select></label>
              <label><span>授权开始</span><input type="date" value={quickStart || ''} onChange={(event) => setQuickStart(event.target.value)} /></label>
              <label><span>授权结束</span><input type="date" value={quickEnd || ''} onChange={(event) => setQuickEnd(event.target.value)} /></label>
              <label><span>分成比例 %</span><input type="number" step="0.01" value={quickShare} onChange={(event) => setQuickShare(event.target.value)} placeholder="可留空" /></label>
              <label><span>通道费率 %</span><input type="number" step="0.01" value={quickFee} onChange={(event) => setQuickFee(event.target.value)} placeholder="可留空" /></label>
              <label><span>税率 %</span><input type="number" step="0.01" value={quickTax} onChange={(event) => setQuickTax(event.target.value)} placeholder="可留空" /></label>
              <label><span>测试费</span><input type="number" step="0.01" value={quickTestingFee} onChange={(event) => setQuickTestingFee(event.target.value)} placeholder="可留空" /></label>
            </div>
            <footer><span>合同字段不确定可以留空；先把正确的研发合同与游戏关系建立起来。</span><div><button type="button" disabled={quickSaving} onClick={() => setQuickOpen(false)}>取消</button><button type="button" className="is-primary" disabled={quickSaving || !quickContractId || !quickGame} onClick={() => void saveQuickSupplement()}>{quickSaving ? '正在保存…' : '保存并重新匹配'}</button></div></footer>
          </div>
        </div>
      ) : null}
    </section>
  )
}
