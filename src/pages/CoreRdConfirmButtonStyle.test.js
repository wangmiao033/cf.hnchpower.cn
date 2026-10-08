import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const styles = readFileSync(new URL('../styles/SimplifiedBillReview.css', import.meta.url), 'utf8')

function cssRule(selector) {
  const escape = (text) => text.replace(/[.*+?^\x24{}()|[\]\\]/g, '\\$&')
  const match = styles.match(new RegExp(escape(selector) + '\\s*\\{([^}]*)\\}'))
  return match?.[1] || ''
}

describe('研发确认按钮对比度保护', () => {
  const action = '.core-bill-form-page--rd .core-bill-footer-actions .confirm-review'

  it('uses bright white text in normal, hover and pressed states', () => {
    for (const state of ['', ':hover:not(:disabled)', ':active:not(:disabled)']) {
      const rule = cssRule(action + state)
      expect(rule).not.toBe('')
      expect(rule).toMatch(/color:\s*#ffffff\s*;/)
    }
  })

  it('keeps the busy state readable rather than dimming the whole button', () => {
    const disabled = cssRule(action + ':disabled')
    expect(disabled).toMatch(/opacity:\s*1\s*;/)
    expect(disabled).toMatch(/color:\s*#334155\s*;/)
    expect(disabled).toMatch(/background:\s*#e2e8f0\s*;/)
  })

  it('shows an adequately sized main action', () => {
    const base = cssRule(action)
    expect(base).toMatch(/height:\s*38px\s*;/)
    expect(base).toMatch(/font-size:\s*13px\s*;/)
  })
})
