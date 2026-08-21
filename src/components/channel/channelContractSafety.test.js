import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const pickerSource = readFileSync(new URL('../shared/PartnerPicker.jsx', import.meta.url), 'utf8')
const billingSource = readFileSync(new URL('./ChannelBillingForm.jsx', import.meta.url), 'utf8')
const smartEntrySource = readFileSync(new URL('./ChannelSmartEntryBar.jsx', import.meta.url), 'utf8')

describe('channel contract safety guards', () => {
  it('does not turn typed exact partner text into an explicit customer selection', () => {
    expect(pickerSource).toContain("onChange(nextValue, '', null)")
    expect(pickerSource).toContain('selectPartner(matches[0])')
  })

  it('requires a stable selected partner before a new channel bill can be saved', () => {
    expect(billingSource).toContain("if (mode === 'add' && !partnerId)")
    expect(billingSource).toContain('明确选择合作方后再保存')
  })

  it('auto-applies exact game rules to new or unconfirmed bills but preserves confirmed bills', () => {
    expect(billingSource).toContain('function canAutoApplyContractRules(mode, status)')
    expect(billingSource).toContain("String(status || 'pending').trim().toLowerCase() !== 'confirmed'")
    expect(billingSource).toContain('if (autoApplyContractRules)')
    expect(billingSource).toContain('item.match && item.auto_apply && item.recommended')
    expect(billingSource).toContain('已确认账单原值保持不变')
    expect(billingSource).toContain('已确认账单规则不会自动覆盖')
  })

  it('does not classify an unmatched game as a business override', () => {
    expect(billingSource).toContain('if (!item?.match) continue')
    expect(billingSource).toContain('未匹配行暂不视为业务差异')
    expect(billingSource).toContain('业务差异 · 当前值未完全按合同清单')
  })

  it('matches historical contracts by the bill month instead of today\'s status', () => {
    expect(smartEntrySource).toContain('const selected = exact.length ? exact : rows')
    expect(smartEntrySource).toContain('item?.authorization_start || contract?.effective_date')
    expect(smartEntrySource).toContain('item?.authorization_end || contract?.end_date')
    expect(smartEntrySource).toContain('accessItemCoversMonth(item, targetMonth, contract)')
    expect(smartEntrySource).not.toContain("contract?.timeline_status !== '已过期'")
    expect(smartEntrySource).not.toContain("if (['已过期', '已终止'].includes(String(item?.timeline_status || ''))) return false")
  })

  it('recognizes previous-month games before forcing a contract supplement', () => {
    expect(smartEntrySource).toContain('const historicalGameKeys = useMemo')
    expect(smartEntrySource).toContain('!contractGameKeys.has(key) && !historicalGameKeys.has(key)')
    expect(smartEntrySource).toContain('const historicalMatchedLineCount = namedLines(record).filter')
    expect(smartEntrySource).toContain('个按上月历史识别')
    expect(smartEntrySource).toContain('只有真正的新游戏才需要补清单')
    expect(smartEntrySource).toContain('contractState.items.length === 0 && previousLines.length === 0')
  })

  it('labels technical errors separately from business rule gaps', () => {
    expect(billingSource).toContain('技术异常 · 合同规则读取失败')
    expect(billingSource).toContain('待补规则：未找到该合作方合同清单')
  })
})
