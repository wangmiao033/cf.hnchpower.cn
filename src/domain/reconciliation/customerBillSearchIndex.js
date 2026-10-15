/**
 * Shared customer-library lookup for bill search (R&D + channel).
 *
 * Library short names, bracket aliases and labels are search metadata, NOT
 * legal identities. Attach them to a bill only through the exact company
 * name / stable customer ID, or a globally unambiguous exact short label.
 *
 * No names or financial fields are rewritten. Never merge businesses because
 * two legal names contain the same brand word.
 */

export function normalizeCustomerIdentity(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/[\s\u00a0]/g, '')
    .toLocaleLowerCase('zh-CN')
}

export function normalizeCustomerSearch(value) {
  return normalizeCustomerIdentity(value).replace(/[()\[\]【】{}.,，。_\-·]+/g, '')
}

function shortNameBase(value) {
  const raw = String(value || '').normalize('NFKC').trim()
  const match = raw.match(/^(.+?)\s*\(([^()]+)\)\s*$/)
  if (!match || !match[2].trim()) return ''
  const base = normalizeCustomerIdentity(match[1])
  return base.length >= 2 ? base : ''
}

function addEntry(index, key, partner) {
  if (!key) return
  const existing = index.get(key) || []
  const identity = normalizeCustomerIdentity(partner.name)
  if (!existing.some(row => normalizeCustomerIdentity(row.name) === identity)) {
    index.set(key, [...existing, partner])
  }
}

export function buildCustomerBillSearchIndex(partners = []) {
  const index = {
    byId: new Map(),
    byLegalName: new Map(),
    byExactAlias: new Map(),
    byBracketBase: new Map()
  }
  for (const source of partners || []) {
    if (!source?.name || !normalizeCustomerIdentity(source.name)) continue
    const partner = {
      id: String(source.id || '').trim(),
      name: String(source.name).trim(),
      shortName: String(source.shortName ?? source.short_name ?? '').trim(),
      tag: String(source.tag2 ?? source.tag ?? '').trim(),
      taxNo: String(source.taxRegistrationNo ?? source.tax_registration_no ?? '').trim()
    }
    if (partner.id) index.byId.set(partner.id, partner)
    addEntry(index.byLegalName, normalizeCustomerIdentity(partner.name), partner)
    addEntry(index.byExactAlias, normalizeCustomerIdentity(partner.shortName), partner)
    addEntry(index.byBracketBase, shortNameBase(partner.shortName), partner)
  }
  return index
}

function uniqueLegalPartner(candidates = []) {
  const byLegalName = new Map()
  for (const partner of candidates) {
    byLegalName.set(normalizeCustomerIdentity(partner.name), partner)
  }
  return byLegalName.size === 1 ? [...byLegalName.values()][0] : null
}

function hasExplicitLegalIdentity(value) {
  return /公司|企业|合伙|工作室|商行|个体|事务所|研究院|开发中心/.test(String(value || ''))
}

/**
 * Return only fields from a safely resolved library customer.
 * "芯动（朋克）" => search 朋克 finds a bill whose saved legal partner equals
 * the library company's name. Searching "朋克4" will not silently include it.
 */
export function customerSearchFieldsForBill(row, index) {
  if (!row || !index) return []
  const linkedId = String(row.partnerId ?? row.partner_id ?? '').trim()
  if (linkedId) {
    const linked = index.byId.get(linkedId)
    return linked ? [linked.name, linked.shortName, linked.tag, linked.taxNo].filter(Boolean) : []
  }

  const billPartner = String(
    row.partnerName ?? row.partner_name ?? row.partner ?? row.partyBName ?? ''
  ).trim()
  const legal = normalizeCustomerIdentity(billPartner)
  const exact = uniqueLegalPartner(index.byLegalName.get(legal))
  if (exact) {
    return [exact.name, exact.shortName, exact.tag, exact.taxNo].filter(Boolean)
  }

  // An explicit nonmatching registered legal entity is evidence against
  // using any other customer's loosely similar channel/brand nickname.
  if (hasExplicitLegalIdentity(billPartner)) return []

  const candidates = [
    billPartner,
    row.channelName ?? row.channel_name,
    row.partnerShortName ?? row.partner_short_name
  ].map(normalizeCustomerIdentity).filter(Boolean)

  const matches = new Map()
  for (const candidate of candidates) {
    for (const partner of [
      ...(index.byExactAlias.get(candidate) || []),
      ...(index.byBracketBase.get(candidate) || [])
    ]) {
      matches.set(normalizeCustomerIdentity(partner.name), partner)
    }
  }
  if (matches.size !== 1) return []
  const result = [...matches.values()][0]
  return [result.name, result.shortName, result.tag, result.taxNo].filter(Boolean)
}

export function linkedCustomerMatchesKeyword(row, query, index) {
  const needle = normalizeCustomerSearch(query)
  return Boolean(
    needle && customerSearchFieldsForBill(row, index).some(
      value => normalizeCustomerSearch(value).includes(needle)
    )
  )
}
