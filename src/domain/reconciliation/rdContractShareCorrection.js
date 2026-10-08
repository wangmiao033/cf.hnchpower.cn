/**
 * An R&D bill's shareRatio is the developer's share; a cooperation-item
 * share_rate is OUR company's share. Keep the contract document untouched:
 * this action only corrects the structured cooperation-list metadata.
 */
const ACCESS_FIELDS = [
  'channel_name', 'agreement_type', 'platform_record_id', 'product_name',
  'app_id', 'platform', 'language', 'category', 'rights_source',
  'game_status', 'agreement_status', 'authorization_start',
  'authorization_end', 'share_rate', 'channel_fee_rate',
  'software_copyright_no', 'isbn', 'territory', 'status', 'remarks'
]

function percentage(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null
  const amount = Number(value)
  return Number.isFinite(amount) && amount >= 0 && amount <= 100
    ? Math.round(amount * 100) / 100
    : null
}

export function proposeRdContractShareCorrection(line, match) {
  const developerShare = percentage(line?.shareRatio)
  const currentOurShare = percentage(match?.our_share_rate)
  if (developerShare === null || currentOurShare === null) return null
  const ourShare = Math.round((100 - developerShare) * 100) / 100
  if (Math.abs(currentOurShare - ourShare) < 0.001) return null
  return { developerShare, ourShare, currentOurShare }
}

export function buildRdContractAccessShareUpdate({
  contract, accessItem, match, line, partnerId, auditDate
}) {
  const change = proposeRdContractShareCorrection(line, match)
  if (!change) throw new Error('当前账单与合同合作清单没有可修正的分成差异。')
  if (!contract?.id || String(contract.id) !== String(match?.contract_id || '')) {
    throw new Error('读取到的合同与当前账单匹配记录不一致，请刷新重试。')
  }
  if (!accessItem?.id || String(accessItem.id) !== String(match?.access_item_id || '') ||
      String(accessItem.contract_id || contract.id) !== String(contract.id)) {
    throw new Error('合作游戏的合同关联已经变化，请刷新后再修改。')
  }
  if (partnerId && contract.partner_id && String(partnerId) !== String(contract.partner_id)) {
    throw new Error('合同所属客户与当前账单客户不同，禁止修改。')
  }
  if (!match?.product_name || String(accessItem.product_name).trim() !== String(match.product_name).trim()) {
    throw new Error('游戏合作清单名称已变化，请在合同管理中核实后再处理。')
  }
  const savedOurShare = percentage(accessItem.share_rate)
  if (savedOurShare === null || Math.abs(savedOurShare - change.currentOurShare) >= 0.001) {
    throw new Error('合同合作清单的分成比例已经变化，请重新匹配后再操作。')
  }
  if (!line?.gameName || match.authorization_status !== 'covered') {
    throw new Error('游戏或合同授权身份尚未核实，不能直接修改合作清单。')
  }
  // PUT /access-items expects the complete document: preserve every other
  // cooperation-list field rather than overwriting missing ones with defaults.
  const payload = Object.fromEntries(ACCESS_FIELDS.map((field) => [field, accessItem[field] ?? '']))
  payload.authorization_start = accessItem.authorization_start || null
  payload.authorization_end = accessItem.authorization_end || null
  payload.channel_fee_rate = accessItem.channel_fee_rate == null ? null : accessItem.channel_fee_rate
  payload.share_rate = change.ourShare

  // Preserve original remarks and an audit trail; never edit scanned contracts.
  const stamp = String(auditDate || '').trim()
  const note = '【研发分成口径校正' + (stamp ? ' ' + stamp : '') + '】合作清单我方分成'
    + change.currentOurShare + '%→' + change.ourShare + '%；研发分成'
    + (100 - change.currentOurShare) + '%→' + change.developerShare
    + '%。依据业务确认修正结构化清单；原始签署合同附件未修改。'
  payload.remarks = [String(accessItem.remarks || '').trim(), note].filter(Boolean).join('\n')
  return { ...change, payload, contractId: String(contract.id), accessItemId: String(accessItem.id) }
}
