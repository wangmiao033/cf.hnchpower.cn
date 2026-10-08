import { describe, expect, it } from 'vitest'
import {
  readRdAutoFlowPreference,
  writeRdAutoFlowPreference,
  RD_AUTO_FLOW_PREFERENCE_KEY
} from './rdAutoFlowPreference.js'

describe('研发账单自动读取流水偏好', () => {
  it('defaults to OFF unless explicitly enabled', () => {
    expect(readRdAutoFlowPreference(null)).toBe(false)
    expect(readRdAutoFlowPreference({ getItem: () => null })).toBe(false)
    expect(readRdAutoFlowPreference({ getItem: () => 'true' })).toBe(false)
    expect(readRdAutoFlowPreference({ getItem: () => 'off' })).toBe(false)
    expect(readRdAutoFlowPreference({ getItem: () => 'on' })).toBe(true)
  })
  it('persists only an opt-in flag, and can be disabled again', () => {
    const db = new Map()
    const storage = {
      getItem: (key) => db.get(key) || null,
      setItem: (key, value) => db.set(key, value)
    }
    writeRdAutoFlowPreference(storage, true)
    expect(db.get(RD_AUTO_FLOW_PREFERENCE_KEY)).toBe('on')
    expect(readRdAutoFlowPreference(storage)).toBe(true)
    writeRdAutoFlowPreference(storage, false)
    expect(db.get(RD_AUTO_FLOW_PREFERENCE_KEY)).toBe('off')
    expect(readRdAutoFlowPreference(storage)).toBe(false)
  })
  it('does not break billing when storage is unavailable', () => {
    const blocked = {
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('denied') }
    }
    expect(readRdAutoFlowPreference(blocked)).toBe(false)
    expect(() => writeRdAutoFlowPreference(blocked, true)).not.toThrow()
  })
})
