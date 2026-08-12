import React, { useMemo, useState } from 'react'
import { initialLineItem, normalizeChannelSettlementCycle } from '@/domain/channel/channelBillingForm.js'
import {
  CHANNEL_FLOW_INPUT_STATE,
  applyChannelFlowPaste,
  channelFlowCompletion,
  parseChannelFlowPaste,
  resolveChannelFlowInputState
} from '@/domain/channel/channelFlowInput.js'
import './ChannelFlowInputPanel.css'

function namedItems(record) {
  return (Array.isArray(record?.items) ? record.items : [])
    .filter((item) => String(item?.gameName || '').trim())
}

function recordMonth(record) {
  const direct = normalizeChannelSettlementCycle(record?.settlementMonth)
  if (/^20\d{2}-\d{2}$/.test(direct)) return direct
  const fromItems = namedItems(record)
    .map((item) => normalizeChannelSettlementCycle(item?.settlementCycle))
    .find((value) => /^20\d{2}-\d{2}$/.test(value))
  return fromItems || ''
}

function flowStatusLabel(item) {
  const state = resolveChannelFlowInputState(item)
  if (state === CHANNEL_FLOW_INPUT_STATE.CONFIRMED_ZERO) return '已确认 0'
  if (state === CHANNEL_FLOW_INPUT_STATE.ENTERED) return '已录入'
  return '待录入'
}

export default function ChannelFlowInputPanel({ record, onApply, onNotice }) {
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const items = useMemo(() => namedItems(record), [record])
  const completion = useMemo(() => channelFlowCompletion(record), [record])
  const parsed = useMemo(() => parseChannelFlowPaste(pasteText), [pasteText])
  const month = recordMonth(record)

  if (!items.length) return null

  const applyItems = (nextItems, message, tone = 'success') => {
    onApply?.({ ...(record || {}), items: nextItems }, message, tone)
  }

  const confirmZero = (gameName) => {
    const nextItems = (Array.isArray(record?.items) ? record.items : []).map((item) => {
      if (String(item?.gameName || '').trim() !== gameName) return item
      return { ...item, flow: '0', flowInputState: CHANNEL_FLOW_INPUT_STATE.CONFIRMED_ZERO }
    })
    applyItems(nextItems, `「${gameName}」已明确确认本期流水为 0。`)
  }

  const confirmAllZero = () => {
    if (!completion.missingCount) return
    const confirmed = window.confirm(
      `确认将当前 ${completion.missingCount} 个“未录入”游戏全部标记为本期流水 0 吗？\n\n这个操作只适用于你已经确认这些游戏本期确实没有充值流水的情况。`
    )
    if (!confirmed) return
    const missing = new Set(completion.missingGames)
    const nextItems = (Array.isArray(record?.items) ? record.items : []).map((item) => {
      const gameName = String(item?.gameName || '').trim()
      if (!missing.has(gameName)) return item
      return { ...item, flow: '0', flowInputState: CHANNEL_FLOW_INPUT_STATE.CONFIRMED_ZERO }
    })
    applyItems(nextItems, `已确认 ${completion.missingCount} 个游戏本期流水为 0。`)
  }

  const applyPaste = () => {
    if (!parsed.rows.length) {
      onNotice?.('没有识别到可粘贴的游戏流水数据。', 'error')
      return
    }
    const result = applyChannelFlowPaste(record, parsed.rows, (gameName) => ({
      ...initialLineItem(),
      gameName,
      settlementCycle: month,
      flowInputState: CHANNEL_FLOW_INPUT_STATE.MISSING
    }))
    const warningText = parsed.warnings.length ? `；${parsed.warnings.length} 个单元格已跳过` : ''
    applyItems(
      result.record.items,
      `已粘贴 ${parsed.rows.length} 行：匹配 ${result.matched} 个，新增 ${result.added} 个游戏${warningText}。`,
      parsed.warnings.length ? 'info' : 'success'
    )
    setPasteOpen(false)
    setPasteText('')
  }

  return (
    <section className={`channel-flow-input ${completion.missingCount ? 'has-missing' : 'is-complete'}`}>
      <div className="channel-flow-input__head">
        <div>
          <span>V3.3 · 流水录入检查</span>
          <strong>{completion.missingCount ? `还有 ${completion.missingCount} 个游戏未录流水` : '本账单流水已全部明确'}</strong>
          <small>空白不会再等同于 0。输入正数自动视为已录；真正 0 流水必须点“确认 0”。</small>
        </div>
        <div className="channel-flow-input__head-actions">
          <button type="button" onClick={() => setPasteOpen(true)}>粘贴 Excel / WPS</button>
          {completion.missingCount > 1 ? <button type="button" onClick={confirmAllZero}>批量确认 0</button> : null}
        </div>
      </div>

      <div className="channel-flow-input__stats" aria-label="流水录入完成度">
        <div><span>游戏</span><strong>{completion.total}</strong></div>
        <div className="is-entered"><span>已录金额</span><strong>{completion.enteredCount}</strong></div>
        <div className="is-zero"><span>确认 0</span><strong>{completion.confirmedZeroCount}</strong></div>
        <div className={completion.missingCount ? 'is-missing' : ''}><span>待录</span><strong>{completion.missingCount}</strong></div>
      </div>

      <div className="channel-flow-input__games">
        {items.map((item) => {
          const gameName = String(item.gameName || '').trim()
          const state = resolveChannelFlowInputState(item)
          const missing = state === CHANNEL_FLOW_INPUT_STATE.MISSING
          return (
            <div key={`${gameName}-${item.id || ''}`} className={`channel-flow-input__game is-${state}`}>
              <span>
                <strong>{gameName}</strong>
                <small>{flowStatusLabel(item)}{state === CHANNEL_FLOW_INPUT_STATE.ENTERED ? ` · ¥${Number(item.flow || 0).toLocaleString('zh-CN')}` : ''}</small>
              </span>
              {missing ? <button type="button" onClick={() => confirmZero(gameName)}>确认本期为 0</button> : null}
            </div>
          )
        })}
      </div>

      {pasteOpen ? (
        <div className="channel-flow-input__mask" onMouseDown={() => setPasteOpen(false)}>
          <div className="channel-flow-input__dialog" role="dialog" aria-modal="true" aria-label="粘贴渠道流水" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <span>PASTE FROM EXCEL / WPS</span>
                <h3>批量粘贴本月流水</h3>
                <p>直接从 Excel/WPS 选中单元格复制，然后粘贴到下面。不会读取 QuickSDK 数据。</p>
              </div>
              <button type="button" onClick={() => setPasteOpen(false)}>×</button>
            </header>
            <div className="channel-flow-input__paste-help">
              <strong>推荐列：</strong>
              <span>游戏名称｜后台流水｜代金券｜退款｜测试费｜平台结算金额</span>
              <small>有表头会自动识别；没有表头就按以上顺序读取。空白单元格不会覆盖原值，明确粘贴 0 会视为“已确认 0”。</small>
            </div>
            <textarea
              autoFocus
              value={pasteText}
              onChange={(event) => setPasteText(event.target.value)}
              placeholder={'游戏名称\t后台流水\t代金券\t退款\n云上征途\t123456\t200\t0\n大灵王\t0\t\t0'}
            />
            <div className="channel-flow-input__preview">
              <span>识别结果</span>
              <strong>{parsed.rows.length} 行</strong>
              <small>{parsed.hasHeader ? '已识别表头' : pasteText.trim() ? '按固定列顺序读取' : '等待粘贴'}</small>
              {parsed.warnings.length ? <em>{parsed.warnings[0]}</em> : null}
            </div>
            <footer>
              <button type="button" onClick={() => setPasteOpen(false)}>取消</button>
              <button type="button" className="is-primary" disabled={!parsed.rows.length} onClick={applyPaste}>应用到当前账单</button>
            </footer>
          </div>
        </div>
      ) : null}
    </section>
  )
}
