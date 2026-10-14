import React from 'react'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import ContractDifferenceActionPanel from '@/components/reconciliation/ContractDifferenceActionPanel.jsx'
import { groupResolvedDifferenceHistory } from './resolvedDifferenceHistory.js'

const accepted = (id, patch = {}) => ({
  id, bill_type: 'channel', bill_id: 'channel-bill-08', line_id: id,
  contract_id: 'contract-01', access_item_id: 'access-01',
  contract_no: 'CNT-2026', statement_no: 'QD-202608',
  game_name: '六界仙尊', settlement_cycle: '2026-08',
  expected_amount: 2009.25, actual_amount: 2009.46, difference_amount: 0.21,
  variance_abs: 0.21, variance_direction: 'over',
  status: 'resolved', handling_type: 'accept_difference',
  reason_type: '商务特殊约定', description: '本期按商务约定结算',
  created_at: '2026-10-12T10:00:00Z', resolved_at: '2026-10-12T11:00:00Z',
  ...patch
})

describe('resolved finance-difference history', () => {
  it('shows one entry for repeated approval after the bill line is regenerated', () => {
    const result = groupResolvedDifferenceHistory([
      accepted('old'),
      accepted('new', { created_at: '2026-10-14T03:00:00Z' }),
      accepted('oldest', { created_at: '2026-10-11T09:00:00Z', reason_type: '商务协商' })
    ])
    expect(result.visibleItems.map((item) => item.id)).toEqual(['new'])
    expect(result.hiddenCount).toBe(2)
    expect([...result.hiddenIds].sort()).toEqual(['old', 'oldest'])
  })

  it('does not hide unresolved or adjustments, cross-bill or cross-contract cases', () => {
    const inputs = [
      accepted('first'),
      accepted('pending', { status: 'pending' }),
      accepted('processing', { status: 'processing' }),
      accepted('adjustment', { handling_type: 'adjustment' }),
      accepted('another-bill', { bill_id: 'another' }),
      accepted('another-contract', { contract_id: 'another-contract' }),
      accepted('another-month', { settlement_cycle: '2026-09' }),
      accepted('another-amount', { actual_amount: 2009.47, difference_amount: 0.22 })
    ]
    expect(groupResolvedDifferenceHistory(inputs).visibleItems).toHaveLength(inputs.length)
  })

  it('does not merge unresolved contract identities without binding evidence', () => {
    const item = accepted('unbound', { contract_id: null, access_item_id: null, contract_no: '' })
    expect(groupResolvedDifferenceHistory([item, { ...item, id: 'unbound-two' }]).hiddenCount).toBe(0)
  })

  it('collapses the visible cards while preserving a history expansion control', () => {
    const html = renderToStaticMarkup(React.createElement(ContractDifferenceActionPanel, {
      billType: 'channel', billId: 'channel-bill-08',
      initialItems: [accepted('old'), accepted('new', { created_at: '2026-10-14T03:00:00Z' })]
    }))
    expect((html.match(/class="contract-difference-card is-resolved"/g) || []).length).toBe(0)
    expect(html).toContain('已解决的 2 条差异已收起')
    expect(html).toContain('查看已解决记录')
    expect(html).not.toContain('已删除')
  })
})
