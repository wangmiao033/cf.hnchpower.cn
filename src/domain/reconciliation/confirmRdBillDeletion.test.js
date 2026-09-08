import { describe, expect, it, vi } from 'vitest'
import { confirmRdBillDeletion } from './confirmRdBillDeletion.js'

function dialogs(reason, finalAnswer = true) {
  return { prompt: vi.fn(() => reason), confirm: vi.fn(() => finalAnswer), showError: vi.fn() }
}

describe('研发账单删除的两次确认', () => {
  it('stops when the first confirmation is cancelled', () => {
    const ui = dialogs(null)
    expect(confirmRdBillDeletion('JS-001', ui)).toBeNull()
    expect(ui.confirm).not.toHaveBeenCalled()
    expect(ui.showError).not.toHaveBeenCalled()
  })
  it('requires a nonblank audit reason before the final confirmation', () => {
    const ui = dialogs('  \n ')
    expect(confirmRdBillDeletion('JS-001', ui)).toBeNull()
    expect(ui.confirm).not.toHaveBeenCalled()
    expect(ui.showError).toHaveBeenCalledWith('删除账单必须填写原因')
  })
  it('stops when the second confirmation is cancelled', () => {
    const ui = dialogs('重复录入', false)
    expect(confirmRdBillDeletion('JS-001', ui)).toBeNull()
    expect(ui.prompt).toHaveBeenCalledTimes(1)
    expect(ui.confirm).toHaveBeenCalledTimes(1)
  })
  it('returns the audit reason only after both confirmations, identifying the same bill', () => {
    const ui = dialogs('  重复录入  ')
    expect(confirmRdBillDeletion('JS-001', ui)).toBe('重复录入')
    expect(ui.prompt).toHaveBeenCalledWith(expect.stringContaining('删除确认（1/2）'), '')
    expect(ui.prompt.mock.calls[0][0]).toContain('JS-001')
    expect(ui.prompt.mock.calls[0][0]).toContain('可恢复')
    expect(ui.confirm).toHaveBeenCalledWith(expect.stringContaining('最终确认（2/2）'))
    expect(ui.confirm.mock.calls[0][0]).toContain('JS-001')
    expect(ui.confirm.mock.calls[0][0]).toContain('重复录入')
    expect(ui.prompt.mock.invocationCallOrder[0]).toBeLessThan(ui.confirm.mock.invocationCallOrder[0])
    expect(ui.showError).not.toHaveBeenCalled()
  })
})
