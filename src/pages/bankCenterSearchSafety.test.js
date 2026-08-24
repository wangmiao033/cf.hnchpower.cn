import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const page = readFileSync(new URL('./BankCenterPageV2.jsx', import.meta.url), 'utf8')
const api = readFileSync(new URL('../lib/api/bankAutoReconciliation.ts', import.meta.url), 'utf8')

describe('bank center search safety', () => {
  it('searches the pending queue on the server before the 500-row cap', () => {
    expect(page).toContain('queueAppliedSearch')
    expect(page).toContain('q: queueAppliedSearch || undefined')
    expect(page).toContain('date_from: requestRange.from || undefined')
    expect(api).toContain("params.set('q', filters.q)")
  })

  it('keeps the all-date preset visually consistent with the query', () => {
    expect(page).toContain("setQueueDateFrom('')")
    expect(page).toContain("setQueueDateTo('')")
    expect(page).toContain('setQueueDateFrom(range.from)')
    expect(page).toContain('setQueueDateTo(range.to)')
  })
})
