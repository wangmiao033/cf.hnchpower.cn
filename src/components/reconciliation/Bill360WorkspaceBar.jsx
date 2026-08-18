import React, { useEffect, useMemo, useRef, useState } from 'react'
import './Bill360WorkspaceBar.css'

function targetKey(target) {
  return `${target?.billType === 'channel' ? 'channel' : 'rd'}:${String(target?.billId || '')}`
}

function billNumber(record, fallback = '') {
  return String(
    record?.settlementNumber ||
    record?.settlement_number ||
    record?.billNumber ||
    record?.statementNo ||
    record?.statement_no ||
    fallback ||
    ''
  ).trim()
}

function partnerName(type, record) {
  return String(
    record?.partnerName ||
    record?.partner_name ||
    record?.developerName ||
    record?.developer_name ||
    record?.channelName ||
    record?.channel_name ||
    record?.customerName ||
    (type === 'channel' ? '渠道账单' : '研发账单')
  ).trim()
}

function settlementMonth(record) {
  const direct = record?.settlementMonth || record?.settlement_month || record?.month || record?.period
  if (direct) return String(direct)
  const lines = record?.items || record?.details || record?.gameDetails || record?.game_details || []
  const values = Array.isArray(lines)
    ? [...new Set(lines.map((line) => line?.settlementMonth || line?.settlement_month || line?.month).filter(Boolean))]
    : []
  return values.slice(0, 2).join(' / ')
}

function makeCandidate(type, record) {
  const id = String(record?.id || '')
  if (!id) return null
  const number = billNumber(record, id)
  const partner = partnerName(type, record)
  const month = settlementMonth(record)
  const game = String(record?.gameName || record?.game_name || record?.productName || '').trim()
  return {
    type,
    id,
    record,
    number,
    partner,
    month,
    game,
    searchText: `${type} ${number} ${partner} ${month} ${game}`.toLowerCase()
  }
}

function targetLabel(target) {
  const type = target?.billType === 'channel' ? 'channel' : 'rd'
  const record = target?.initialRecord || {}
  return {
    typeText: type === 'channel' ? '渠道' : '研发',
    number: billNumber(record, target?.billId),
    partner: partnerName(type, record)
  }
}

function Bill360WorkspaceBar({
  targets = [],
  rdRecords = [],
  channelRecords = [],
  onOpen,
  onClose,
  onCloseAll
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [query, setQuery] = useState('')
  const searchRef = useRef(null)

  const openedKeys = useMemo(() => new Set(targets.map(targetKey)), [targets])
  const candidates = useMemo(() => {
    const rows = [
      ...(rdRecords || []).map((record) => makeCandidate('rd', record)),
      ...(channelRecords || []).map((record) => makeCandidate('channel', record))
    ].filter(Boolean)
    const keyword = query.trim().toLowerCase()
    return rows
      .filter((item) => !openedKeys.has(`${item.type}:${item.id}`))
      .filter((item) => !keyword || item.searchText.includes(keyword))
      .slice(0, 80)
  }, [channelRecords, openedKeys, query, rdRecords])

  useEffect(() => {
    if (!pickerOpen) return undefined
    const timer = window.setTimeout(() => searchRef.current?.focus(), 30)
    return () => window.clearTimeout(timer)
  }, [pickerOpen])

  useEffect(() => {
    if (targets.length >= 2) setPickerOpen(false)
  }, [targets.length])

  if (!targets.length) return null

  const openCandidate = (item) => {
    onOpen?.(item.type, item.id, item.record)
    setPickerOpen(false)
    setQuery('')
  }

  return (
    <div className={`bill360-workspace-bar-host is-${targets.length === 2 ? 'dual' : 'single'}`}>
      <div className="bill360-workspace-bar" role="toolbar" aria-label="账单工作区">
        <div className="bill360-workspace-bar__brand">
          <span>账单工作区</span>
          <strong>{targets.length}/2</strong>
        </div>

        <div className="bill360-workspace-bar__tabs">
          {targets.map((target, index) => {
            const label = targetLabel(target)
            return (
              <div className="bill360-workspace-tab" key={targetKey(target)} title={`${label.typeText} · ${label.partner} · ${label.number}`}>
                <span>{index + 1}</span>
                <div>
                  <strong>{label.typeText} · {label.number}</strong>
                  <small>{label.partner}</small>
                </div>
                <button type="button" onClick={() => onClose?.(target)} aria-label={`关闭账单 ${label.number}`}>×</button>
              </div>
            )
          })}
        </div>

        {targets.length < 2 ? (
          <button
            type="button"
            className="bill360-workspace-bar__add"
            onClick={() => setPickerOpen((value) => !value)}
            aria-expanded={pickerOpen}
          >
            ＋ 同时打开第二张
          </button>
        ) : (
          <span className="bill360-workspace-bar__mode">双栏核对</span>
        )}

        <button type="button" className="bill360-workspace-bar__close-all" onClick={onCloseAll}>关闭工作区</button>
      </div>

      {pickerOpen ? (
        <div className="bill360-workspace-picker" role="dialog" aria-label="选择第二张账单">
          <div className="bill360-workspace-picker__head">
            <div>
              <span>第二张账单</span>
              <strong>不用关闭当前账单，直接并排核对</strong>
            </div>
            <button type="button" onClick={() => setPickerOpen(false)} aria-label="关闭选择器">×</button>
          </div>
          <div className="bill360-workspace-picker__search">
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索账单号、合作方、月份、游戏…"
            />
          </div>
          <div className="bill360-workspace-picker__list">
            {candidates.length ? candidates.map((item) => (
              <button type="button" key={`${item.type}:${item.id}`} onClick={() => openCandidate(item)}>
                <span className={`bill360-workspace-picker__type is-${item.type}`}>{item.type === 'channel' ? '渠' : '研'}</span>
                <div>
                  <strong>{item.number}</strong>
                  <span>{[item.partner, item.month, item.game].filter(Boolean).join(' · ')}</span>
                </div>
                <em>打开</em>
              </button>
            )) : (
              <div className="bill360-workspace-picker__empty">没有找到可打开的第二张账单</div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default Bill360WorkspaceBar
