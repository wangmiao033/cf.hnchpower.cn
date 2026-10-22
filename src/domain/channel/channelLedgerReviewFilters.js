import { normalizeBillStatus, REVIEWED_BILL_AMENDABLE_STATUSES } from '@/domain/reconciliation/billLifecycle.js'

export const DEFAULT_CHANNEL_LEDGER_FILTERS = Object.freeze({
  month: '',
  channel: '',
  status: '',
  query: '',
  quickFilter: 'all',
  reviewFilter: 'all',
  ledgerView: 'detail',
  fromMonth: '',
  toMonth: '',
  gameQuery: '',
  sortMode: 'month-desc',
  showMoreFilters: false,
  flatPageSize: 100
})

const QUICK_FILTERS = new Set(['all', 'unpaid', 'partial', 'settled', 'data-diff', 'trash', 'archived'])
const REVIEW_FILTERS = new Set(['all', 'pending', 'reviewed'])
const VIEWS = new Set(['detail', 'group', 'audit'])
const SORT_MODES = new Set(['month-desc', 'month-asc', 'unpaid-desc', 'settlement-desc', 'channel-asc'])
const BILL_STATUSES = new Set(['', 'draft', 'pending', 'confirmed', 'completed', 'cancelled'])
const PAGE_SIZES = new Set([25, 50, 100])

const cleanText = (value) => typeof value === 'string' ? value.slice(0, 500) : ''
const cleanMonth = (value) => /^\d{4}-(0[1-9]|1[0-2])$/.test(value || '') ? value : ''
const selectKnown = (value, values, fallback) => values.has(value) ? value : fallback

// Review status is sourced only from the bill lifecycle, never payment,
// invoice, validation or amount matching.
export function isChannelBillReviewed(row) {
  return REVIEWED_BILL_AMENDABLE_STATUSES.has(normalizeBillStatus(row?.status))
}

export function matchesChannelReviewFilter(row, value) {
  if (value === 'reviewed') return isChannelBillReviewed(row)
  if (value === 'pending') return !isChannelBillReviewed(row)
  return true
}

export function normalizeChannelLedgerFilters(saved) {
  const state = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {}
  return {
    month: cleanMonth(state.month),
    channel: cleanText(state.channel),
    status: selectKnown(state.status, BILL_STATUSES, ''),
    query: cleanText(state.query),
    quickFilter: selectKnown(state.quickFilter, QUICK_FILTERS, 'all'),
    reviewFilter: selectKnown(state.reviewFilter, REVIEW_FILTERS, 'all'),
    ledgerView: selectKnown(state.ledgerView, VIEWS, 'detail'),
    fromMonth: cleanMonth(state.fromMonth),
    toMonth: cleanMonth(state.toMonth),
    gameQuery: cleanText(state.gameQuery),
    sortMode: selectKnown(state.sortMode, SORT_MODES, 'month-desc'),
    showMoreFilters: state.showMoreFilters === true,
    flatPageSize: selectKnown(state.flatPageSize, PAGE_SIZES, 100)
  }
}

export function channelLedgerFilterStorageKey(accountKey = '') {
  const key = String(accountKey || 'default').slice(0, 120)
  return 'cf:channel-ledger-filters:v1:' + encodeURIComponent(key)
}

export function loadChannelLedgerFilters(accountKey, storage) {
  try {
    const store = storage ?? (typeof window !== 'undefined' ? window.localStorage : null)
    if (!store) return normalizeChannelLedgerFilters(null)
    const raw = store.getItem(channelLedgerFilterStorageKey(accountKey))
    return normalizeChannelLedgerFilters(raw ? JSON.parse(raw) : null)
  } catch {
    // Private browsing and restricted browsers may deny persistent storage.
    return normalizeChannelLedgerFilters(null)
  }
}

export function saveChannelLedgerFilters(accountKey, filters, storage) {
  try {
    const store = storage ?? (typeof window !== 'undefined' ? window.localStorage : null)
    if (!store) return false
    store.setItem(channelLedgerFilterStorageKey(accountKey), JSON.stringify(normalizeChannelLedgerFilters(filters)))
    return true
  } catch {
    // Filtering still works in memory when storage is unavailable.
    return false
  }
}
