import { describe, expect, it } from 'vitest'
import { sortInvoicesByMatchScore } from './invoiceMatchPriority.js'

describe('sortInvoicesByMatchScore', () => {
  it('puts higher match scores first and uses issue date as tie breaker', () => {
    const rows = [
      { id: 'a', issueDate: '2026-08-15' },
      { id: 'b', issueDate: '2026-08-12' },
      { id: 'c', issueDate: '2026-08-14' },
      { id: 'd', issueDate: '2026-08-16' }
    ]
    const scores = { a: 0.72, b: 0.95, c: 0.95 }

    expect(sortInvoicesByMatchScore(rows, scores).map((item) => item.id)).toEqual([
      'c',
      'b',
      'a',
      'd'
    ])
  })

  it('keeps source order stable when score and date are the same', () => {
    const rows = [
      { id: 'a', issueDate: '2026-08-15' },
      { id: 'b', issueDate: '2026-08-15' }
    ]

    expect(sortInvoicesByMatchScore(rows, { a: 0.8, b: 0.8 }).map((item) => item.id)).toEqual(['a', 'b'])
  })
})
