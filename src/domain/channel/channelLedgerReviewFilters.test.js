import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CHANNEL_LEDGER_FILTERS,
  channelLedgerFilterStorageKey,
  isChannelBillReviewed,
  loadChannelLedgerFilters,
  matchesChannelReviewFilter,
  saveChannelLedgerFilters
} from './channelLedgerReviewFilters.js'

function memoryStorage() {
  const items = new Map()
  return {
    getItem: (key) => items.has(key) ? items.get(key) : null,
    setItem: (key, value) => items.set(key, value)
  }
}

describe('channel ledger review shortcuts', () => {
  it('follows the same lifecycle classification as the table, not cash collection or matching', () => {
    for (const status of ['confirmed', 'invoiced', 'completed', 'settled', 'reconciled', 'verified']) {
      expect(isChannelBillReviewed({ status })).toBe(true)
      expect(matchesChannelReviewFilter({ status }, 'reviewed')).toBe(true)
      expect(matchesChannelReviewFilter({ status }, 'pending')).toBe(false)
    }
    for (const status of ['draft', 'pending', undefined]) {
      const row = { status, validationStatus: 'pass', receivedAmount: 100 }
      expect(isChannelBillReviewed(row)).toBe(false)
      expect(matchesChannelReviewFilter(row, 'pending')).toBe(true)
    }
    expect(matchesChannelReviewFilter({ status: 'pending' }, 'all')).toBe(true)
  })

  it('remembers month, channel, both status filters, search and view on re-entry', () => {
    const storage = memoryStorage()
    const saved = {
      ...DEFAULT_CHANNEL_LEDGER_FILTERS,
      month: '2026-07',
      channel: '渠道A',
      query: '游戏001',
      quickFilter: 'unpaid',
      reviewFilter: 'pending',
      ledgerView: 'group',
      sortMode: 'unpaid-desc',
      showMoreFilters: true,
      flatPageSize: 50
    }
    expect(saveChannelLedgerFilters('user-1', saved, storage)).toBe(true)
    expect(loadChannelLedgerFilters('user-1', storage)).toEqual(saved)
  })

  it('keeps preferences separated by signed-in account', () => {
    const storage = memoryStorage()
    saveChannelLedgerFilters('account-1', { month: '2026-07', reviewFilter: 'pending' }, storage)
    expect(loadChannelLedgerFilters('account-2', storage)).toEqual(DEFAULT_CHANNEL_LEDGER_FILTERS)
    expect(channelLedgerFilterStorageKey('account-1')).not.toEqual(channelLedgerFilterStorageKey('account-2'))
  })

  it('restores safe defaults from stale or malformed saved values', () => {
    const storage = memoryStorage()
    storage.setItem(channelLedgerFilterStorageKey('a'), JSON.stringify({
      month: 'wrong',
      reviewFilter: 'unknown',
      quickFilter: 'nonsense',
      channel: 123,
      flatPageSize: 999,
      ledgerView: 'invalid'
    }))
    expect(loadChannelLedgerFilters('a', storage)).toEqual(DEFAULT_CHANNEL_LEDGER_FILTERS)
    storage.setItem(channelLedgerFilterStorageKey('a'), '{broken-json')
    expect(loadChannelLedgerFilters('a', storage)).toEqual(DEFAULT_CHANNEL_LEDGER_FILTERS)
  })

  it('does not interrupt filter use when browser storage is denied', () => {
    const denied = {
      getItem: () => { throw new Error('SecurityError') },
      setItem: () => { throw new Error('SecurityError') }
    }
    expect(loadChannelLedgerFilters('a', denied)).toEqual(DEFAULT_CHANNEL_LEDGER_FILTERS)
    expect(saveChannelLedgerFilters('a', { month: '2026-07' }, denied)).toBe(false)
  })
})
