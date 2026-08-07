import { describe, expect, it } from 'vitest'
import {
  buildReconciliationAnomalies,
  normalizeMonthKey,
  summarizeAnomalies
} from './reconciliationAnomalies.js'

const rdBase = {
  id: 'rd-1',
  settlementNumber: 'JS-202608-001',
  settlementMonth: '2026年7月',
  partnerId: 'partner-1',
  partner: '研发商甲有限公司',
  partnerShortName: '研发商甲',
  game: '游戏A',
  gameFlow: '1000',
  settlementAmount: '500.00',
  paidAmount: '0.00',
  status: 'confirmed',
  items: [
    { settlementCycle: '2026年7月', gameName: '游戏A', revenue: '1000' }
  ]
}

const channelBase = {
  id: 'channel-1',
  billNumber: 'QD-202608-001',
  settlementMonth: '2026-07',
  partnerName: '渠道商甲有限公司',
  channelName: '渠道商甲',
  settlementAmount: 800,
  receivedAmount: 900,
  status: 'pending',
  items: [{ gameName: '游戏A' }]
}

describe('reconciliation anomaly center rules', () => {
  it('normalizes common settlement month formats', () => {
    expect(normalizeMonthKey('2026年7月')).toBe('2026-07')
    expect(normalizeMonthKey('2026-07')).toBe('2026-07')
    expect(normalizeMonthKey('2026/7/31')).toBe('2026-07')
  })

  it('detects payment, invoice, QuickSDK and contract risks', () => {
    const anomalies = buildReconciliationAnomalies({
      rdRecords: [rdBase],
      channelRecords: [channelBase],
      invoiceOverviews: [
        {
          bill_type: 'rd',
          bill_id: 'rd-1',
          bill_amount: 500,
          allocated_amount: 300,
          remaining_amount: 200,
          coverage_percent: 60,
          coverage_status: 'partial',
          allocation_count: 1
        },
        {
          bill_type: 'channel',
          bill_id: 'channel-1',
          bill_amount: 800,
          allocated_amount: 0,
          remaining_amount: 800,
          coverage_percent: 0,
          coverage_status: 'none',
          allocation_count: 0
        }
      ],
      contracts: [
        {
          id: 'contract-1',
          partner_id: 'partner-1',
          partner_name: '研发商甲有限公司',
          timeline_status: '已过期',
          contract_name: '研发合作协议'
        }
      ],
      quickSdkMonthly: [{ settlement_month: '2026-06' }]
    })

    expect(anomalies.some((item) => item.id.startsWith('invoice-partial:rd:rd-1'))).toBe(true)
    expect(anomalies.some((item) => item.id.startsWith('quicksdk-month-missing:rd:rd-1'))).toBe(true)
    expect(anomalies.some((item) => item.id.startsWith('contract-expired:rd:rd-1'))).toBe(true)
    expect(anomalies.some((item) => item.id.startsWith('payment-over:channel:channel-1'))).toBe(true)
  })

  it('detects duplicate bill numbers and final bills with unpaid balances', () => {
    const second = { ...rdBase, id: 'rd-2', paidAmount: '100.00', status: 'completed' }
    const anomalies = buildReconciliationAnomalies({
      rdRecords: [rdBase, second],
      quickSdkMonthly: [{ settlement_month: '2026-07' }]
    })

    expect(anomalies.some((item) => item.id.startsWith('duplicate-number:rd:js-202608-001'))).toBe(true)
    expect(anomalies.some((item) => item.id.startsWith('final-but-unpaid:rd:rd-2'))).toBe(true)
  })

  it('applies ignored/resolved states and summarizes pending severity', () => {
    const firstPass = buildReconciliationAnomalies({
      channelRecords: [channelBase]
    })
    const payment = firstPass.find((item) => item.category === 'payment')
    expect(payment).toBeTruthy()

    const secondPass = buildReconciliationAnomalies({
      channelRecords: [channelBase],
      statusMap: { [payment.id]: 'ignored' }
    })
    const summary = summarizeAnomalies(secondPass)
    expect(summary.ignored).toBe(1)
    expect(summary.critical).toBe(0)
  })
})
