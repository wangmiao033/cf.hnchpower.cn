import { describe, expect, it } from 'vitest'

function visibleIds(rows, archivedIds, mode = 'active') {
  const archived = new Set(archivedIds.map(String))
  return rows
    .filter((row) => mode === 'archived' ? archived.has(String(row.id)) : !archived.has(String(row.id)))
    .map((row) => String(row.id))
}

describe('bill archive list visibility', () => {
  const rows = [{ id: '1' }, { id: '2' }, { id: '3' }]

  it('hides archived bills from the default active list', () => {
    expect(visibleIds(rows, ['2'])).toEqual(['1', '3'])
  })

  it('keeps archived bills available in the archive view', () => {
    expect(visibleIds(rows, ['2'], 'archived')).toEqual(['2'])
  })
})
