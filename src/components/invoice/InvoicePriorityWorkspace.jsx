import React, { useEffect, useMemo, useState } from 'react'
import { AppStateProvider, useAppState } from '@/app/AppStateContext.jsx'
import { autoMatchInvoices } from '@/lib/api/billInvoiceAllocations.ts'
import { getInvoiceRecordId } from '@/lib/api/invoice.ts'
import { sortInvoicesByMatchScore } from '@/domain/invoice/invoiceMatchPriority.js'
import InvoiceManageWorkspace from './InvoiceManageWorkspace.jsx'

const MATCH_CACHE_TTL_MS = 30_000
const matchCache = new Map()

function cacheKey(direction, ids) {
  return `${direction}:${ids.join(',')}`
}

function scoreMapFromResult(result) {
  return Object.fromEntries(
    (result?.items || []).map((item) => [String(item.invoice_id), Number(item.match_score || 0)])
  )
}

export default function InvoicePriorityWorkspace({ variant = 'manage', direction = 'output' }) {
  const appState = useAppState()
  const filteredInvoices = appState.invoice?.filteredInvoices || []
  const invoiceApiEnabled = Boolean(appState.invoice?.invoiceApiEnabled)
  const [scoreById, setScoreById] = useState({})

  const invoiceIds = useMemo(
    () => filteredInvoices
      .map((item) => getInvoiceRecordId(item) || item.id)
      .filter(Boolean)
      .map(String)
      .slice(0, 500),
    [filteredInvoices]
  )
  const idsKey = invoiceIds.join(',')

  useEffect(() => {
    if (!invoiceApiEnabled || invoiceIds.length === 0) {
      setScoreById({})
      return undefined
    }

    const key = cacheKey(direction, invoiceIds)
    const cached = matchCache.get(key)
    if (cached && cached.expiresAt > Date.now()) {
      setScoreById(cached.scores)
      return undefined
    }

    let cancelled = false
    const timer = window.setTimeout(() => {
      void autoMatchInvoices({
        invoice_direction: direction,
        invoice_ids: invoiceIds,
        threshold: 0.5,
        unique_margin: 0,
        dry_run: true
      })
        .then((result) => {
          if (cancelled) return
          const scores = scoreMapFromResult(result)
          matchCache.set(key, { scores, expiresAt: Date.now() + MATCH_CACHE_TTL_MS })
          setScoreById(scores)
        })
        .catch(() => {
          if (!cancelled) setScoreById({})
        })
    }, 120)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [direction, idsKey, invoiceApiEnabled])

  const prioritizedInvoices = useMemo(
    () => sortInvoicesByMatchScore(
      filteredInvoices,
      scoreById,
      (item) => getInvoiceRecordId(item) || item.id
    ),
    [filteredInvoices, scoreById]
  )

  const nestedState = useMemo(
    () => ({
      ...appState,
      invoice: {
        ...appState.invoice,
        filteredInvoices: prioritizedInvoices
      }
    }),
    [appState, prioritizedInvoices]
  )

  return (
    <AppStateProvider value={nestedState}>
      <InvoiceManageWorkspace variant={variant} direction={direction} />
    </AppStateProvider>
  )
}
