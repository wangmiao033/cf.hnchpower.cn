import { describe, expect, it } from 'vitest'
import {
  auditChannelBillMonths,
  channelAuditMonths,
  lastCompletedChannelMonth
} from './channelMonthCoverage.js'

const now = new Date(2026, 9, 9, 12, 0, 0)
const bill = (month, opts = {}) => ({
  id: month + (opts.id || ''),
  channelName: opts.channel || '掌控智能（八门）',
  settlementMonth: month,
  status: opts.status || 'pending',
  items: opts.items || [{ settlementCycle: month, gameName: '测试游戏' }]
})

describe('channel ledger missing-month audit', () => {
  it('checks only fully ended months and handles year boundaries', () => {
    expect(lastCompletedChannelMonth(now)).toBe('2026-09')
    expect(channelAuditMonths({ now })).toEqual([
      '2026-04','2026-05','2026-06','2026-07','2026-08','2026-09'
    ])
    expect(channelAuditMonths({ now: new Date(2027, 0, 2), windowSize: 3 }))
      .toEqual(['2026-10', '2026-11', '2026-12'])
    expect(channelAuditMonths({ now, endingMonth: '2027-11', windowSize: 3 }))
      .toEqual(['2026-07','2026-08','2026-09'])
  })

  it('finds August between July and September; filling August removes the flag', () => {
    const apr = bill('2026-04')
    const jul = bill('2026-07')
    const sep = bill('2026-09')
    const before = auditChannelBillMonths([apr, jul, sep], { now })
    expect(before.gapMonthCount).toBe(3)
    expect(before.channels[0].gaps).toEqual(['2026-05', '2026-06', '2026-08'])
    const after = auditChannelBillMonths([apr, jul, bill('2026-08'), sep], { now })
    expect(after.gapMonthCount).toBe(2)
    expect(after.channels[0].gaps).toEqual(['2026-05', '2026-06'])
    expect(after.channels[0].cells.find((cell) => cell.month === '2026-08')).toMatchObject({
      kind: 'recorded', count: 1
    })
  })

  it('treats archived bills as present; cancelled bills do not close gaps', () => {
    const base = [bill('2026-07'), bill('2026-09')]
    const archived = auditChannelBillMonths([...base, bill('2026-08', { status: 'confirmed' })], { now })
    expect(archived.channels[0].gaps).toEqual([])
    const canceled = auditChannelBillMonths([...base, bill('2026-08', { status: 'cancelled' })], { now })
    expect(canceled.channels[0].gaps).toEqual(['2026-08'])
  })

  it('counts multi-month bills by their line months, not only header month', () => {
    const record = bill('2026-09', { items: [
      { gameName: 'A', settlementCycle: '2026-07' },
      { gameName: 'B', settlementCycle: '2026-08' },
      { gameName: 'C', settlementCycle: '2026-09' }
    ] })
    const audit = auditChannelBillMonths([record], { now })
    expect(audit.gapMonthCount).toBe(0)
    expect(audit.channels[0].covered).toBe(3)
    expect(audit.channels[0].recordedBills).toBe(3)
  })

  it('separates later unrecorded months from internal gaps and ignores earlier unobserved months', () => {
    const audit = auditChannelBillMonths([bill('2026-07')], { now })
    expect(audit.gapMonthCount).toBe(0)
    expect(audit.trailingChannelCount).toBe(1)
    expect(audit.channels[0].trailing).toEqual(['2026-08', '2026-09'])
    expect(audit.channels[0].cells[0].kind).toBe('before')
  })

  it('ignores old inactive channels outside the window, as well as future bills', () => {
    const audit = auditChannelBillMonths([
      bill('2025-01', { channel: '历史渠道' }),
      bill('2026-09', { channel: '正常渠道' }),
      bill('2026-10', { channel: '正常渠道', id: 'future' })
    ], { now })
    expect(audit.coveredChannelCount).toBe(1)
    expect(audit.channels[0].name).toBe('正常渠道')
    expect(audit.gapChannelCount).toBe(0)
  })

  it('keeps distinct channels separate and counts multiple bills in one period', () => {
    const audit = auditChannelBillMonths([
      bill('2026-07', { channel: ' 八门 ' }),
      bill('2026-07', { channel: '八门', id: 'second' }),
      bill('2026-09', { channel: '八门' }),
      bill('2026-08', { channel: '另一个渠道' })
    ], { now })
    expect(audit.coveredChannelCount).toBe(2)
    const bamen = audit.channels.find((channel) => channel.name === '八门')
    expect(bamen.gaps).toEqual(['2026-08'])
    expect(bamen.cells.find((cell) => cell.month === '2026-07').count).toBe(2)
  })
})
