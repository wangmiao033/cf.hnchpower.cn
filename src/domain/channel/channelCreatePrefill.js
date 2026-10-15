/** Resolve exactly one customer-linked channel from the current ledger scope.
 * Search terms can also match games or bill IDs. Such matches alone must never
 * select a customer automatically; the CHANNEL / legal customer must match.
 */
import { findExactPartner, partnerKey } from '@/components/shared/PartnerPicker.jsx'

const name = (value) => String(value || '').trim()

export function resolveChannelCreatePrefill({ records = [], partners = [], channelName = '', search = '' } = {}) {
  const explicit = partnerKey(channelName)
  const keyword = partnerKey(search)
  if (!explicit && !keyword) return null

  const candidates = (records || []).flatMap((row) => {
    const ledgerChannel = name(row?.channelName)
    const ledgerPartner = name(row?.partnerName)
    if (!ledgerChannel && !ledgerPartner) return []
    if (explicit && partnerKey(ledgerChannel) !== explicit) return []

    const customer = findExactPartner(partners, ledgerPartner) || findExactPartner(partners, ledgerChannel)
    // A search may match a GAME / statement number rather than the channel.
    // Only the channel or its linked customer's actual names justify prefill.
    if (!explicit && keyword && ![
      ledgerChannel, ledgerPartner, customer?.name, customer?.shortName
    ].some(value => partnerKey(value).includes(keyword))) return []

    if (!customer?.id || !customer?.name) return [null]
    return [{
      partnerId: String(customer.id),
      partnerName: name(customer.name),
      channelName: ledgerChannel || name(customer.shortName) || name(customer.name)
    }]
  })

  if (!candidates.length || candidates.some(item => !item)) return null
  const unique = new Map(candidates.map(item => [
    item.partnerId + '|' + partnerKey(item.channelName), item
  ]))
  // Same search result set can contain several bills; that is fine. Several
  // customer IDs or channel labels are NOT fine: ask to select a specific one.
  return unique.size === 1 ? [...unique.values()][0] : null
}
