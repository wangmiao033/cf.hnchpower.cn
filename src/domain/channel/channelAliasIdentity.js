/**
 * Presentation-only repair for a legacy combined channel label.
 *
 * "西安游海网络科技有限公司" and "西安麦游网络科技有限公司" are
 * separate customer-library entries. A shared old channel label does NOT
 * prove they are the same legal entity. Resolve the old label only when
 * the new and old bills have the exact same non-empty legal partner name.
 *
 * This never edits server records, contracts, receipts or invoice data.
 */
const OLD_CHANNEL_LABEL = '游海(麦游)'
const CURRENT_CHANNEL_LABEL = '游海'

function key(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .toLocaleLowerCase('zh-CN')
}

function channelName(row) {
  return row?.channelName ?? row?.channel_name ?? ''
}

function legalPartnerKey(row) {
  const normalized = key(row?.partnerName ?? row?.partner_name)
  // Short names can be shared between unrelated legal entities.
  return /公司|合伙企业|工商户/.test(normalized) ? normalized : ''
}

export function unifyLegacyChannelNamesForSamePartner(records = []) {
  if (!Array.isArray(records) || records.length === 0) return records

  const currentPartners = new Set(
    records
      .filter(row => key(channelName(row)) === CURRENT_CHANNEL_LABEL)
      .map(legalPartnerKey)
      .filter(Boolean)
  )
  if (currentPartners.size === 0) return records

  return records.map(row => {
    const formerName = channelName(row)
    if (key(formerName) !== OLD_CHANNEL_LABEL) return row
    const partner = legalPartnerKey(row)
    if (!partner || !currentPartners.has(partner)) return row
    return {
      ...row,
      // Keep the original in memory for reconciliation and diagnostics.
      originalChannelName: formerName,
      channelName: CURRENT_CHANNEL_LABEL
    }
  })
}


/**
 * Historical channel keyword search, not company identity normalization.
 * 西安游海网络科技有限公司 and 西安麦游网络科技有限公司 remain
 * separate legal customers; "海游" is accepted as a search-only word swap.
 */
const CHANNEL_SEARCH_VARIANTS = Object.freeze([
  '游海', '麦游', '海游', '游海(麦游)', '游海麦游'
])
const CHANNEL_SEARCH_KEYS = new Set(CHANNEL_SEARCH_VARIANTS.map(key))

export function channelSearchAliasTerms(query) {
  const needle = key(query)
  return needle && CHANNEL_SEARCH_KEYS.has(needle) ? [...CHANNEL_SEARCH_VARIANTS] : []
}

export function channelLedgerMatchesSearch(row, query, otherFields = []) {
  const needle = key(query)
  if (!needle) return true
  const fields = [
    row?.statementNo, row?.billNumber,
    row?.channelName, row?.originalChannelName, row?.partnerName,
    row?.gameName, ...(otherFields || [])
  ].map(key).filter(Boolean)
  if (fields.some(field => field.includes(needle))) return true

  const synonyms = channelSearchAliasTerms(query).map(key)
  if (!synonyms.length) return false
  // Do not expand game names or notes into a different customer.
  return [row?.channelName, row?.originalChannelName, row?.partnerName]
    .map(key).some(field => synonyms.some(alias => field.includes(alias)))
}
