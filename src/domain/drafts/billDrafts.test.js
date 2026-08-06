import { beforeEach, describe, expect, it } from 'vitest'
import {
  areNormalizedDraftsEqual,
  billDraftKey,
  clearBillDraft,
  isMeaningfulChannelDraft,
  isMeaningfulRdDraft,
  normalizeChannelDraft,
  normalizeRdDraft,
  readBillDraft,
  writeBillDraft
} from './billDrafts.js'

function createStorage() {
  const values = new Map()
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key)
  }
}

describe('bill drafts', () => {
  beforeEach(() => {
    globalThis.window = { localStorage: createStorage() }
  })

  it('distinguishes default empty forms from meaningful records', () => {
    expect(isMeaningfulRdDraft({
      settlementMonth: '2026年8月',
      items: [{ discountRate: '1', shareRatio: '15', revenue: '0' }]
    })).toBe(false)
    expect(isMeaningfulRdDraft({ partner: '研发商甲' })).toBe(true)

    expect(isMeaningfulChannelDraft({
      items: [{ discountFactor: '1', flow: '0', settlementAmount: '0' }]
    })).toBe(false)
    expect(isMeaningfulChannelDraft({ settlementMonth: '2026-08' })).toBe(true)
  })

  it('normalizes numeric strings before dirty comparison', () => {
    expect(
      areNormalizedDraftsEqual(
        { partner: '甲', items: [{ revenue: '100.00', shareRatio: '15.0' }] },
        { partner: '甲', items: [{ revenue: 100, shareRatio: 15 }] },
        normalizeRdDraft
      )
    ).toBe(true)

    expect(
      areNormalizedDraftsEqual(
        { channelName: '渠道甲', items: [{ flow: '80.00' }] },
        { channelName: '渠道甲', items: [{ flow: 81 }] },
        normalizeChannelDraft
      )
    ).toBe(false)
  })

  it('persists, reads, and clears a versioned local draft', () => {
    const key = billDraftKey('rd', 'edit', 'record-1')
    const savedAt = writeBillDraft(key, { partner: '甲' }, 'base-v1')
    expect(savedAt).toBeGreaterThan(0)
    expect(readBillDraft(key)).toMatchObject({
      record: { partner: '甲' },
      baseVersion: 'base-v1'
    })

    clearBillDraft(key)
    expect(readBillDraft(key)).toBeNull()
  })
})
