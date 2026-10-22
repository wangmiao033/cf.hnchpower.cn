import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  ChannelRevenueBasisSelector,
  ChannelRevenueBasisPreview,
  isRevenueBasisChangeLocked
} from './ChannelBillingForm.jsx'
import { displayRevenueBasis } from './ChannelBillReadonlyView.jsx'
import { newSmartLine } from './ChannelSmartEntryBar.jsx'

const header = {
  channelName: '爱趣', partnerName: '昆山爱趣网络科技有限公司',
  settlementRuleCode: 'share_only', channelFeeMode: 'none', taxMode: 'none'
}
const row = {
  gameName: '测试游戏', flow: '1000.00', discountFactor: '0.1',
  voucherFaceValue: '0', voucherDirectCost: '0', shareRate: '30', taxRate: '0'
}
const render = (component, props) => renderToStaticMarkup(React.createElement(component, props))
const find = (node, predicate) => {
  if (!node || typeof node !== 'object') return null
  if (predicate(node)) return node
  for (const child of React.Children.toArray(node.props?.children)) {
    const found = find(child, predicate)
    if (found) return found
  }
  return null
}
const previewProps = (extra = {}) => ({ row, header, index: 0, nextBasis: 'post_discount', onApply: vi.fn(), onCancel: vi.fn(), onVoucherReview: vi.fn(), ...extra })
const applyButton = tree => find(tree, node => node.type === 'button' && node.props.children === '应用本行流水口径')

describe('Aiqu revenue basis component safety', () => {
  it('shows an exact-channel-only selector and keeps a legacy row selected as pre-discount', () => {
    const html = render(ChannelRevenueBasisSelector, { row, header, index: 0 })
    expect(html).toContain('value="pre_discount" selected=""')
    expect(html).toContain('录入流水 × 游戏折扣')
    for (const wrong of [
      { ...header, channelName: '4399' },
      { ...header, partnerName: '其他爱趣网络科技有限公司' },
      { ...header, channelName: '爱趣渠道' }
    ]) expect(render(ChannelRevenueBasisSelector, { row, header: wrong, index: 0 })).toBe('')
  })

  it('selecting a basis requests a preview without changing any input', () => {
    const onRequest = vi.fn()
    const before = structuredClone(row)
    const tree = ChannelRevenueBasisSelector({ row, header, index: 0, onRequest })
    find(tree, node => node.type === 'select').props.onChange({ target: { value: 'post_discount' } })
    expect(onRequest).toHaveBeenCalledWith('post_discount')
    expect(row).toEqual(before)
    expect(row.revenueBasis).toBeUndefined()
  })

  it('shows exact before/after flow and settlement while retaining the game factor', () => {
    const html = render(ChannelRevenueBasisPreview, previewProps())
    expect(html).toContain('¥100.00 → ¥1000.00')
    expect(html).toContain('¥30.00 → ¥300.00')
    expect(html).toContain('游戏折扣保留 0.1')
    expect(html).toContain('不改成 1')
    expect(html).toContain('尚未应用')
    expect(html).toContain('输入已折后流水，游戏折扣仅版本参考')
    expect(html).toContain('其他扣减均实际金额')
  })

  it('requires explicit separate face-voucher review and never changes the voucher', () => {
    const faceRow = { ...row, voucherFaceValue: '100' }
    const before = structuredClone(faceRow)
    const props = previewProps({ row: faceRow })
    const tree = ChannelRevenueBasisPreview(props)
    expect(applyButton(tree).props.disabled).toBe(true)
    const checkbox = find(tree, node => node.type === 'input' && node.props.type === 'checkbox')
    checkbox.props.onChange({ target: { checked: true } })
    expect(props.onVoucherReview).toHaveBeenCalledWith(true)
    expect(props.onApply).not.toHaveBeenCalled()
    expect(faceRow).toEqual(before)
    expect(render(ChannelRevenueBasisPreview, props)).toContain('单独选择「直扣」')
    const reviewed = ChannelRevenueBasisPreview({ ...props, voucherFaceReviewed: true })
    expect(applyButton(reviewed).props.disabled).toBe(false)
  })

  it('does not require face review for an explicitly direct voucher or a change back to pre-discount', () => {
    const direct = ChannelRevenueBasisPreview(previewProps({ row: { ...row, voucherFaceValue: null, voucherDirectCost: '100' } }))
    expect(applyButton(direct).props.disabled).toBe(false)
    expect(find(direct, node => node.type === 'input' && node.props.type === 'checkbox')).toBeNull()
    const backwards = ChannelRevenueBasisPreview(previewProps({ row: { ...row, revenueBasis: 'post_discount', voucherFaceValue: '100' }, nextBasis: 'pre_discount' }))
    expect(applyButton(backwards).props.disabled).toBe(false)
  })

  it('leaves apply and cancel as separate deliberate actions', () => {
    const props = previewProps()
    const tree = ChannelRevenueBasisPreview(props)
    expect(props.onApply).not.toHaveBeenCalled()
    find(tree, node => node.type === 'button' && node.props.children === '取消，保留原口径').props.onClick()
    expect(props.onCancel).toHaveBeenCalledOnce()
    expect(props.onApply).not.toHaveBeenCalled()
    applyButton(tree).props.onClick()
    expect(props.onApply).toHaveBeenCalledOnce()
  })

  it.each(['confirmed', 'invoiced', 'completed', 'settled', 'reconciled', 'verified', 'cancelled'])('locks immutable source lifecycle %s even if a draft says pending', status => {
    expect(isRevenueBasisChangeLocked({ mode: 'edit', sourceRecord: { status }, draftRecord: { status: 'pending' } })).toBe(true)
  })

  it('locks actual receipts and confirmed bank matches, not a display-only paid status on a zero bill', () => {
    expect(isRevenueBasisChangeLocked({ mode: 'edit', sourceRecord: { status: 'pending', receivedAmount: 0, receiptStatus: 'paid' } })).toBe(false)
    expect(isRevenueBasisChangeLocked({ mode: 'edit', sourceRecord: { status: 'pending', receivedAmount: 0.01 } })).toBe(true)
    expect(isRevenueBasisChangeLocked({ sourceRecord: { status: 'pending', receipts: [{ amount: 0 }] } })).toBe(true)
    expect(isRevenueBasisChangeLocked({ sourceRecord: { status: 'pending', bankMatches: [{ status: 'confirmed' }] } })).toBe(true)
    expect(isRevenueBasisChangeLocked({ mode: 'readonly' })).toBe(true)
    expect(isRevenueBasisChangeLocked({ mode: 'edit', recordId: 'loading' })).toBe(true)
    expect(isRevenueBasisChangeLocked({ mode: 'add' })).toBe(false)
  })

  it('disables both the selector and pending apply for a protected record', () => {
    expect(find(ChannelRevenueBasisSelector({ row, header, index: 0, locked: true }), node => node.type === 'select').props.disabled).toBe(true)
    expect(applyButton(ChannelRevenueBasisPreview(previewProps({ locked: true, voucherFaceReviewed: true }))).props.disabled).toBe(true)
  })
})

describe('basis remains understandable after save and monthly generation', () => {
  it('labels saved and legacy basis without recalculating readonly money', () => {
    expect(displayRevenueBasis(null)).toBe('折前原始流水（按折扣换算）')
    expect(displayRevenueBasis('post_discount')).toBe('已折后流水（不再乘游戏折扣）')
    expect(displayRevenueBasis('invalid')).toContain('未知')
    const source = readFileSync(new URL('./ChannelBillReadonlyView.jsx', import.meta.url), 'utf8')
    expect(source.match(/\['流水口径', 'revenueBasis', 'revenueBasis'\]/g)).toHaveLength(2)
    expect(source).not.toContain('calculateSettlementDetails')
  })

  it('keeps a previous explicit basis and discount but never carries monthly monetary amounts', () => {
    const line = newSmartLine('新月份游戏', '2026-10', { ...row, revenueBasis: 'post_discount', flow: '9999' })
    expect(line.revenueBasis).toBe('post_discount')
    expect(line.discountFactor).toBe('0.1')
    expect(line.flow).toBe('')
    expect(line.voucherFaceValue).toBeNull()
    expect(line.voucherDirectCost).toBeNull()
    expect(newSmartLine('新游戏', '2026-10').revenueBasis).toBe('pre_discount')
    expect(newSmartLine('历史旧游戏', '2026-10', row).revenueBasis).toBe('pre_discount')
  })
})
