import { describe, expect, it } from 'vitest'

import { mergeContractScanResults, type SmartContractScanResult } from './contractSmartScan.ts'

function result(partial: Partial<SmartContractScanResult>): SmartContractScanResult {
  return {
    contract: {},
    confidence: {},
    evidence: {},
    parties: { party_a: '', party_b: '', our_party: '' },
    access_items: [],
    summary: '',
    warnings: [],
    file: { name: 'part.pdf', size_bytes: 100, content_type: 'application/pdf' },
    model: 'test-model',
    ...partial
  }
}

describe('segmented contract smart scan', () => {
  it('keeps the highest-confidence non-empty contract field across parts', () => {
    const merged = mergeContractScanResults([
      result({
        contract: { contract_name: '手机游戏联合运营合作协议', end_date: '' },
        confidence: { contract_name: 0.95, end_date: 0.1 },
        evidence: { contract_name: '第一页标题', end_date: '' },
        parties: { party_a: '上海圆戏网络科技有限公司', party_b: '广州熊动科技有限公司', our_party: '广州熊动科技有限公司' }
      }),
      result({
        contract: { contract_name: '合作协议', end_date: '2027-05-31' },
        confidence: { contract_name: 0.62, end_date: 0.99 },
        evidence: { contract_name: '局部页眉', end_date: '第七条期限与终止' },
        parties: { party_a: '', party_b: '广州熊动科技有限公司', our_party: '广州熊动科技有限公司' }
      })
    ], {
      name: '手机游戏联合运营合作协议.pdf',
      size: 8_362_009,
      type: 'application/pdf'
    })

    expect(merged.contract.contract_name).toBe('手机游戏联合运营合作协议')
    expect(merged.contract.end_date).toBe('2027-05-31')
    expect(merged.evidence.end_date).toBe('第七条期限与终止')
    expect(merged.parties.party_b).toBe('广州熊动科技有限公司')
    expect(merged.file.size_bytes).toBe(8_362_009)
    expect(merged.scan_parts).toBe(2)
  })

  it('merges duplicate game access rows from different pages by confidence', () => {
    const merged = mergeContractScanResults([
      result({
        access_items: [{
          values: { product_name: '异界深渊：大灵王', channel_name: '', share_rate: '20', authorization_end: '' },
          confidence: { product_name: 0.99, channel_name: 0.1, share_rate: 0.95, authorization_end: 0.1 },
          evidence: { product_name: '合作游戏清单', channel_name: '', share_rate: '甲方分成比例20', authorization_end: '' }
        }]
      }),
      result({
        access_items: [{
          values: { product_name: '异界深渊：大灵王', channel_name: '', share_rate: '', authorization_end: '2027-05-31' },
          confidence: { product_name: 0.92, channel_name: 0.1, share_rate: 0.1, authorization_end: 0.99 },
          evidence: { product_name: '合作游戏清单', channel_name: '', share_rate: '', authorization_end: '合作期限' }
        }]
      })
    ], {
      name: '合同.pdf',
      size: 8_000_000,
      type: 'application/pdf'
    })

    expect(merged.access_items).toHaveLength(1)
    expect(merged.access_items[0].values.product_name).toBe('异界深渊：大灵王')
    expect(merged.access_items[0].values.share_rate).toBe('20')
    expect(merged.access_items[0].values.authorization_end).toBe('2027-05-31')
  })
})
