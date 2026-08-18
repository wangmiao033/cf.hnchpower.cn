import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const pickerSource = readFileSync(new URL('../shared/PartnerPicker.jsx', import.meta.url), 'utf8')
const billingSource = readFileSync(new URL('./ChannelBillingForm.jsx', import.meta.url), 'utf8')

describe('channel contract safety guards', () => {
  it('does not turn typed exact partner text into an explicit customer selection', () => {
    expect(pickerSource).toContain("onChange(nextValue, '', null)")
    expect(pickerSource).toContain('selectPartner(matches[0])')
  })

  it('requires a stable selected partner before a new channel bill can be saved', () => {
    expect(billingSource).toContain("if (mode === 'add' && !partnerId)")
    expect(billingSource).toContain('明确选择合作方后再保存')
  })

  it('auto-applies contract rules only to new bills', () => {
    expect(billingSource).toContain("if (mode === 'add') {\n            setLines")
    expect(billingSource).toContain('历史账单原值保持不变')
    expect(billingSource).toContain('历史账单规则不会自动覆盖')
  })

  it('labels technical errors separately from business rule gaps', () => {
    expect(billingSource).toContain('技术异常 · 合同规则读取失败')
    expect(billingSource).toContain('待补规则：未找到该合作方合同清单')
    expect(billingSource).toContain('业务差异 · 当前值未完全按合同清单')
  })
})
