import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const formSource = fs.readFileSync(new URL('../../components/channel/ChannelBillingForm.jsx', import.meta.url), 'utf8')

describe('contract-first channel defaults', () => {
  it('does not fall back to 30/5 when no contract rule is found', () => {
    expect(formSource).not.toContain("shareRate: String(row.shareRate || '30')")
    expect(formSource).not.toContain("taxRate: String(row.taxRate || '5')")
    expect(formSource).toContain('新增账单的分成/税率/通道费保持空白')
  })

  it('clears rate fields when game identity or settlement month changes', () => {
    expect(formSource).toContain("identityChanged && mode === 'add' ? { shareRate: '', taxRate: '' } : {}")
  })

  it('does not copy the previous line rate into a new game without a contract baseline', () => {
    expect(formSource).toContain("else if (mode !== 'add')")
    expect(formSource).toContain("next.shareRate = ''")
    expect(formSource).toContain("next.taxRate = ''")
  })
})
