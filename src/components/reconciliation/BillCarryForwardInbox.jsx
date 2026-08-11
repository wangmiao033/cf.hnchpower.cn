import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  applyContractCarryForward,
  listContractCarryForwards
} from '@/lib/api/contractDifferences.ts'
import './BillCarryForwardInbox.css'

function money(value) {
  const number = Number(value || 0)
  return `¥${number.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function normalizeMonth(value) {
  const raw = String(value || '').trim()
  let match = raw.match(/^(\d{4})-(\d{1,2})$/)
  if (match) return `${match[1]}-${String(Number(match[2])).padStart(2, '0')}`
  match = raw.match(/^(\d{4})年(\d{1,2})月$/)
  if (match) return `${match[1]}-${String(Number(match[2])).padStart(2, '0')}`
  match = raw.match(/^(\d{4})[/.](\d{1,2})$/)
  if (match) return `${match[1]}-${String(Number(match[2])).padStart(2, '0')}`
  return raw
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '')
}

function gameMatches(carryGame, billGames) {
  const source = normalizeText(carryGame)
  if (!source) return false
  return billGames.some((game) => {
    const target = normalizeText(game)
    return target && (source === target || source.includes(target) || target.includes(source))
  })
}

export default function BillCarryForwardInbox({ billType, billId, reconciliation, onChanged }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [workingId, setWorkingId] = useState('')
  const [message, setMessage] = useState('')

  const bill = reconciliation?.bill || {}
  const partnerName = String(bill.partner_name || '').trim()
  const billMonth = normalizeMonth(bill.settlement_month)
  const lineMonths = useMemo(
    () => (reconciliation?.lines || []).map((line) => normalizeMonth(line.settlement_cycle)).filter(Boolean),
    [reconciliation]
  )
  const billMonths = useMemo(
    () => Array.from(new Set([billMonth, ...lineMonths].filter(Boolean))),
    [billMonth, lineMonths]
  )
  const billGames = useMemo(
    () => (reconciliation?.lines || []).map((line) => line.game_name).filter(Boolean),
    [reconciliation]
  )

  const load = useCallback(async () => {
    if (!billId || !partnerName || billMonths.length === 0 || billGames.length === 0) {
      setItems([])
      return
    }
    setLoading(true)
    setMessage('')
    try {
      const result = await listContractCarryForwards({
        partnerName,
        status: 'all',
        limit: 200
      })
      const matched = (result.items || []).filter((item) => {
        if (item.status === 'applied') {
          return item.target_bill_type === billType && String(item.target_bill_id) === String(billId)
        }
        if (item.status !== 'pending') return false
        if (!billMonths.includes(normalizeMonth(item.target_month))) return false
        return gameMatches(item.game_name, billGames)
      })
      setItems(matched)
    } catch (error) {
      console.error(error)
      setMessage('待冲抵记录读取失败。')
    } finally {
      setLoading(false)
    }
  }, [billGames, billId, billMonths, billType, partnerName])

  useEffect(() => {
    void load()
  }, [load])

  const apply = async (item) => {
    setWorkingId(item.id)
    setMessage('')
    try {
      await applyContractCarryForward(item.id, {
        target_bill_type: billType,
        target_bill_id: billId,
        note: `已关联到 ${bill.statement_no || billId}，作为独立合同差异冲抵记录留痕。`
      })
      setMessage('冲抵记录已关联到当前账单，上期合同差异已关闭。')
      await load()
      await onChanged?.()
    } catch (error) {
      console.error(error)
      setMessage(error instanceof Error ? error.message : '冲抵关联失败。')
    } finally {
      setWorkingId('')
    }
  }

  if (!items.length && !loading && !message) return null

  return (
    <section className="bill-carry-inbox">
      <header>
        <div>
          <span>上期差异 · 自动提醒</span>
          <h3>待冲抵记录</h3>
          <p>匹配合作方、游戏和目标账期；冲抵作为独立调整链路保存，不自动改写当前账单原始金额。</p>
        </div>
        {loading ? <em>读取中…</em> : null}
      </header>

      {message ? <div className="bill-carry-inbox__message">{message}</div> : null}

      <div className="bill-carry-inbox__list">
        {items.map((item) => (
          <div key={item.id} className={`bill-carry-inbox__item is-${item.status}`}>
            <div>
              <strong>{item.game_name || '游戏'} · {item.target_month}</strong>
              <span>
                来源 {item.source_month || '-'} · {item.direction === 'next_period_deduct' ? '本期扣减' : '本期补加'} {money(item.amount)}
              </span>
            </div>
            {item.status === 'applied' ? (
              <em>已关联本账单</em>
            ) : (
              <button type="button" disabled={workingId === item.id} onClick={() => void apply(item)}>
                {workingId === item.id ? '关联中…' : '一键关联到本账单'}
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
