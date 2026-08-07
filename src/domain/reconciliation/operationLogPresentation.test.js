import { describe, expect, it } from 'vitest'
import {
  formatOperationValue,
  operationActionMeta,
  operationActorLabel,
  operationChangeLines
} from './operationLogPresentation.js'

describe('operation log presentation', () => {
  it('formats money, percent and actor labels', () => {
    expect(formatOperationValue('settlement_amount', 1234.5)).toBe('¥1,234.50')
    expect(formatOperationValue('share_rate', 30)).toBe('30%')
    expect(operationActorLabel({ actor_email: 'finance@example.com' })).toBe('finance')
    expect(operationActorLabel({ actor_email: '' })).toBe('系统')
  })

  it('turns database change json into readable rows', () => {
    const lines = operationChangeLines({
      status: { before: 'pending', after: 'confirmed' },
      settlement_amount: { before: 100, after: 120 }
    })
    expect(lines).toEqual([
      { field: 'status', label: '账单状态', before: 'pending', after: 'confirmed' },
      { field: 'settlement_amount', label: '结算金额', before: '¥100.00', after: '¥120.00' }
    ])
  })

  it('maps key audit actions', () => {
    expect(operationActionMeta('invoice_link')).toMatchObject({ label: '关联发票', mark: '票' })
    expect(operationActionMeta('status_change')).toMatchObject({ label: '状态变更', mark: '态' })
  })
})
