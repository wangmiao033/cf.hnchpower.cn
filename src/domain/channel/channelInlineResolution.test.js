import { describe, expect, it } from 'vitest'
import {
  emptyAliasMemory,
  normalizeInlineKey,
  parsePendingNotes,
  rememberAlias,
  resolveAlias,
  updatePendingNote
} from './channelInlineResolution.js'

describe('渠道名称映射', () => {
  it('统一全半角括号、空格和大小写', () => {
    expect(normalizeInlineKey(' 云上征途（005） ')).toBe('云上征途(005)')
  })

  it('记住游戏和渠道别名并可解析为标准名', () => {
    let memory = emptyAliasMemory()
    memory = rememberAlias(memory, 'game', '云上征途005专服01', '云上征途')
    memory = rememberAlias(memory, 'channel', '9917', '西安维真')

    expect(resolveAlias(memory, 'game', '云上征途005专服01')).toBe('云上征途')
    expect(resolveAlias(memory, 'channel', '9917')).toBe('西安维真')
    expect(resolveAlias(memory, 'game', '龙吟大陆')).toBe('龙吟大陆')
  })
})

describe('待补资料随账单备注持久化', () => {
  it('不会破坏原备注，并能增加、更新、移除行级待补事项', () => {
    const first = updatePendingNote('本期正常', '云上征途', '等商务确认活动扣款')
    expect(first).toContain('本期正常')
    expect(first).toContain('【待补资料·云上征途】等商务确认活动扣款')

    const changed = updatePendingNote(first, '云上征途', '已催商务，等回复')
    const parsed = parsePendingNotes(changed)
    expect(parsed.cleanRemark).toBe('本期正常')
    expect(parsed.items).toEqual([{ key: '云上征途', note: '已催商务，等回复' }])

    const cleared = updatePendingNote(changed, '云上征途', '')
    expect(parsePendingNotes(cleared)).toEqual({ cleanRemark: '本期正常', items: [] })
  })
})
