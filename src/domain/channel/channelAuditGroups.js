import { normalizeCustomerIdentity } from '@/domain/reconciliation/customerBillSearchIndex.js'

const legalMarker = /公司|企业|合伙|事务所|研究院|工商户|工作室/
const trim = (value) => String(value ?? '').trim()
const normalized = (value) => normalizeCustomerIdentity(value)
const groupKey = (value) => normalized(value)

function add(map, key, partner) {
  if (!key) return
  const rows = map.get(key) || []
  if (!rows.some(row => row.id === partner.id)) map.set(key, [...rows, partner])
}

function unique(map, key) {
  if (!key) return null
  const rows = map.get(key) || []
  return rows.length === 1 ? rows[0] : null
}

/** Only a customer ID or exact unique official name/short name is evidence.
 * Shared partial names and free-form tags MUST NOT link distinct legal entities.
 */
export function buildChannelAuditGroupIndex(partners = []) {
  const byId = new Map()
  const byLegal = new Map()
  const byAlias = new Map()
  const byGroup = new Map()
  for (const raw of partners || []) {
    const p = {
      id: trim(raw?.id), name: trim(raw?.name),
      shortName: trim(raw?.shortName ?? raw?.short_name),
      groupName: trim(raw?.channelAuditGroup ?? raw?.channel_audit_group)
    }
    if (!p.id || !p.name) continue
    byId.set(p.id, p)
    add(byLegal, normalized(p.name), p)
    add(byAlias, normalized(p.shortName), p)
    if (p.groupName) {
      const gid = groupKey(p.groupName)
      add(byGroup, gid, p)
    }
  }
  return { byId, byLegal, byAlias, byGroup }
}

export function resolveAuditCustomer(row, index) {
  if (!row || !index) return null
  const id = trim(row.partnerId ?? row.partner_id)
  if (id) return index.byId.get(id) || null
  const partnerName = trim(row.partnerName ?? row.partner_name)
  // A legal entity name must match exactly; never map it to a similar short
  // name or another company's customer ID.
  if (partnerName) {
    const legal = unique(index.byLegal, normalized(partnerName))
    if (legal) return legal
    if (legalMarker.test(partnerName)) return null
  }
  const candidateKeys = [
    normalized(partnerName),
    normalized(row.partnerShortName ?? row.partner_short_name),
    normalized(row.channelName ?? row.channel_name)
  ].filter(Boolean)
  const matches = new Map()
  for (const candidate of candidateKeys) {
    const match = unique(index.byAlias, candidate)
    if (match) matches.set(match.id, match)
  }
  return matches.size === 1 ? [...matches.values()][0] : null
}

export function auditGroupIdentity(row, index) {
  const company = resolveAuditCustomer(row, index)
  const grouped = trim(company?.groupName)
  if (!grouped) return null
  return {
    key: 'group:' + groupKey(grouped),
    name: grouped,
    customer: company,
    memberCompanies: (index.byGroup.get(groupKey(grouped)) || []).map(p => p.name),
  }
}

export function auditIdentityForBill(row, index) {
  const group = auditGroupIdentity(row, index)
  if (group) return { ...group, isGroup: true }
  const display = trim(row?.channelName ?? row?.channel_name)
  return {
    key: 'channel:' + normalized(display),
    name: display,
    customer: resolveAuditCustomer(row, index),
    isGroup: false,
    memberCompanies: []
  }
}

export function groupContainsKeyword(identity, query) {
  const needle = normalized(query)
  return Boolean(
    needle && identity?.isGroup &&
    [identity.name, ...(identity.memberCompanies || [])].some(label =>
      normalized(label).includes(needle)
    )
  )
}

/** Used by the audit → ledger drilldown. An explicit member group is the
 * only additional condition; never overwrite the original channel/company.
 */
export function billIsMemberOfAuditGroup(row, partners, groupId) {
  if (!String(groupId || '').startsWith('group:')) return false
  const index = buildChannelAuditGroupIndex(partners)
  return auditIdentityForBill(row, index).key === groupId
}
