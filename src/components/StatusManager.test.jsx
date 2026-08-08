import { describe, expect, it } from 'vitest'

import { BatchStatusUpdate, getStatusInfo } from './StatusManager.jsx'

describe('simplified bill status UI', () => {
  it('uses review wording for the two everyday statuses', () => {
    expect(getStatusInfo('pending').label).toBe('待核对')
    expect(getStatusInfo('confirmed').label).toBe('已核对')
  })

  it('does not expose the legacy batch status editor', () => {
    expect(BatchStatusUpdate()).toBeNull()
  })
})
