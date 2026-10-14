import { describe, expect, it } from 'vitest'
import { assessChannelSavePreflight } from './channelSavePreflight.js'
const old = { status:'pending', updatedAt:'2026-10-14T10:00:00.000Z', settlementAmount:93.33 }
const current = { status:'pending', updated_at:'2026-10-14T10:00:00.000Z', settlement_amount:93.33 }

describe('channel save state matrix (server always authoritative)', () => {
  it('permits unchanged pending snapshot without touching money', () => {
    expect(assessChannelSavePreflight(old,current)).toEqual({
      allowed:true,kind:'editable',message:''
    })
    expect(current.settlement_amount).toBe(93.33)
  })
  for (const status of ['confirmed','invoiced','completed','reconciled','verified','settled','cancelled']) {
    it('blocks any financial update when server is '+status+' despite stale pending UI', () => {
      const actual = assessChannelSavePreflight(old,{...current,status})
      expect(actual).toMatchObject({ allowed:false,kind:'locked' })
      expect(actual.message).toContain('没有保存或覆盖')
    })
  }
  it('detects another tab editing a still-pending bill without overwriting local draft', () => {
    expect(assessChannelSavePreflight(old,{
      ...current, updated_at:'2026-10-14T10:00:04.000Z'
    })).toMatchObject({allowed:false,kind:'version'})
  })
  it('accepts different ISO offsets of the same exact revision', () => {
    expect(assessChannelSavePreflight(old,{
      ...current,updated_at:'2026-10-14T18:00:00+08:00'
    }).allowed).toBe(true)
  })
  it('rejects corrupted revisions rather than treating them as current', () => {
    expect(assessChannelSavePreflight(old,{
      ...current, updated_at:'invalid'
    })).toMatchObject({allowed:false,kind:'version'})
  })
  it('does not misinterpret an already-confirmed server bill as just a version mismatch', () => {
    expect(assessChannelSavePreflight(old,{
      ...current,status:'confirmed',updated_at:'2026-10-14T10:00:04.000Z'
    })).toMatchObject({allowed:false,kind:'locked'})
  })
})
