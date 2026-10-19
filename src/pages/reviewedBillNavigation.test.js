import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

// Exercise the actual JSX callback bodies without rendering the large bill
// forms or calling their live financial APIs.
const cases = [
  ['channel', 'CoreChannelBillFormPage.jsx', 'stableRecord'],
  ['rd', 'CoreRdBillFormPage.jsx', 'stableEditRecord']
]

describe('reviewed bill audit navigation', () => {
  it.each(cases)('%s opens the same saved bill without leaving its read-only page', (billType, filename, recordVariable) => {
    const source = readFileSync(new URL(`./${filename}`, import.meta.url), 'utf8')
    const callback = source.match(/onOpen360=\{\(\) => \{([\s\S]*?)\n        \}\}/)?.[1]
    expect(callback).toBeTruthy()
    const openBill360 = vi.fn()
    const goList = vi.fn()
    const record = Object.freeze({ id: 42, status: 'confirmed', settlementAmount: '123.45' })
    new Function('openBill360', 'goList', recordVariable, callback)(openBill360, goList, record)
    expect(openBill360).toHaveBeenCalledTimes(1)
    expect(openBill360).toHaveBeenCalledWith(billType, '42', record)
    expect(goList).not.toHaveBeenCalled()
    expect(source).toContain('onBack={goList}')
  })
})
