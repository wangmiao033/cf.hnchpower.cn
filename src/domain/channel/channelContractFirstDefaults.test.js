import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { initialLineItem, recordToLineForms } from './channelBillingForm.js'

const formSource = fs.readFileSync(new URL('../../components/channel/ChannelBillingForm.jsx', import.meta.url), 'utf8')

describe('contract-first channel defaults', () => {
  it('does not invent 30%/5% for a new line', () => {
    const line = initialLineItem()
    expect(line.shareRate).toBe('')
    expect(line.taxRate).toBe('')
  })

  it('keeps missing persisted rates blank instead of restoring legacy defaults', () => {
    const [line] = recordToLineForms({
      settlementMonth: '2026-07',
      items: [{ gameName: '一起来修仙（0.05折）', settlementCycle: '2026-07' }]
    })
    expect(line.shareRate).toBe('')
    expect(line.taxRate).toBe('')
  })

  it('does not fall back to 30/5 when no contract rule is found', () => {
    expect(formSource).not.toContain("shareRate: String(row.shareRate || '30')")
    expect(formSource).not.toContain("taxRate: String(row.taxRate || '5')")
    expect(formSource).toContain('新增账单的分成/税率/通道费保持空白')
  })

  it('clears rate fields when game identity or settlement month changes', () => {
    expect(formSource).toContain("identityChanged && mode === 'add' ? { shareRate: '', taxRate: '' } : {}")
  })
})
