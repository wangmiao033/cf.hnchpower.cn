import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { AppStateProvider, useAppState } from '@/app/AppStateContext.jsx'
import { autoMatchInvoices } from '@/lib/api/billInvoiceAllocations.ts'
import { getInvoiceRecordId } from '@/lib/api/invoice.ts'
import {
  archiveInvoiceRecord,
  syncInvoiceArchiveRecords,
  unarchiveInvoiceRecord
} from '@/lib/api/invoiceArchive.ts'
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

function recordId(item) {
  return String(getInvoiceRecordId(item) || item?.id || '')
}

export default function InvoicePriorityWorkspace({ variant = 'manage', direction = 'output' }) {
  const appState = useAppState()
  const filteredInvoices = appState.invoice?.filteredInvoices || []
  const invoiceApiEnabled = Boolean(appState.invoice?.invoiceApiEnabled)
  const [scoreById, setScoreById] = useState({})
  const [archiveScope, setArchiveScope] = useState('active')
  const [archiveSnapshot, setArchiveSnapshot] = useState({
    archived_ids: [],
    held_ids: [],
    archived_count: 0,
    held_count: 0,
    items: []
  })
  const [archiveBusyId, setArchiveBusyId] = useState('')

  const archivedIdSet = useMemo(
    () => new Set((archiveSnapshot.archived_ids || []).map(String)),
    [archiveSnapshot.archived_ids]
  )
  const heldIdSet = useMemo(
    () => new Set((archiveSnapshot.held_ids || []).map(String)),
    [archiveSnapshot.held_ids]
  )

  const activeInvoices = useMemo(
    () => filteredInvoices.filter((item) => !archivedIdSet.has(recordId(item))),
    [archivedIdSet, filteredInvoices]
  )
  const archivedInvoices = useMemo(
    () => filteredInvoices.filter((item) => archivedIdSet.has(recordId(item))),
    [archivedIdSet, filteredInvoices]
  )

  const refreshArchiveState = useCallback(async ({ silent = true } = {}) => {
    if (!invoiceApiEnabled) return null
    try {
      const snapshot = await syncInvoiceArchiveRecords()
      setArchiveSnapshot(snapshot)
      if (!silent && (snapshot.auto_archived || snapshot.auto_reopened)) {
        appState.showToast?.(
          `发票归档已同步：归档 ${snapshot.auto_archived || 0} 张，恢复 ${snapshot.auto_reopened || 0} 张`,
          'success'
        )
      }
      return snapshot
    } catch (error) {
      console.error(error)
      if (!silent) appState.showToast?.('发票归档状态同步失败，请稍后重试', 'error')
      return null
    }
  }, [appState, invoiceApiEnabled])

  useEffect(() => {
    if (!invoiceApiEnabled) {
      setArchiveSnapshot({ archived_ids: [], held_ids: [], archived_count: 0, held_count: 0, items: [] })
      return
    }
    void refreshArchiveState({ silent: true })
  }, [invoiceApiEnabled, refreshArchiveState])

  useEffect(() => {
    setArchiveScope('active')
  }, [direction])

  const invoiceIds = useMemo(
    () => activeInvoices
      .map(recordId)
      .filter(Boolean)
      .slice(0, 500),
    [activeInvoices]
  )
  const idsKey = invoiceIds.join(',')

  useEffect(() => {
    if (!invoiceApiEnabled || invoiceIds.length === 0 || archiveScope !== 'active') {
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
  }, [archiveScope, direction, idsKey, invoiceApiEnabled])

  const prioritizedActiveInvoices = useMemo(
    () => sortInvoicesByMatchScore(
      activeInvoices,
      scoreById,
      (item) => getInvoiceRecordId(item) || item.id
    ),
    [activeInvoices, scoreById]
  )

  const displayedInvoices = archiveScope === 'archived'
    ? archivedInvoices
    : prioritizedActiveInvoices

  const runArchiveAction = useCallback(async (invoiceId, action) => {
    if (!invoiceApiEnabled || !invoiceId || archiveBusyId) return
    setArchiveBusyId(String(invoiceId))
    try {
      if (action === 'unarchive') {
        await unarchiveInvoiceRecord(String(invoiceId))
        appState.showToast?.('已取消归档，发票已回到待处理区', 'success')
      } else {
        await archiveInvoiceRecord(String(invoiceId))
        appState.showToast?.('发票已重新归档', 'success')
      }
      await refreshArchiveState({ silent: true })
    } catch (error) {
      console.error(error)
      const message = error?.data?.detail?.message || error?.message || '归档操作失败'
      appState.showToast?.(message, 'error')
    } finally {
      setArchiveBusyId('')
    }
  }, [appState, archiveBusyId, invoiceApiEnabled, refreshArchiveState])

  const nestedState = useMemo(
    () => ({
      ...appState,
      invoice: {
        ...appState.invoice,
        filteredInvoices: displayedInvoices
      }
    }),
    [appState, displayedInvoices]
  )

  return (
    <AppStateProvider value={nestedState}>
      <InvoiceManageWorkspace
        variant={variant}
        direction={direction}
        archiveScope={archiveScope}
        onArchiveScopeChange={setArchiveScope}
        activeArchiveCount={activeInvoices.length}
        archivedArchiveCount={archivedInvoices.length}
        heldArchiveIds={heldIdSet}
        archiveBusyId={archiveBusyId}
        onUnarchiveInvoice={(invoiceId) => runArchiveAction(invoiceId, 'unarchive')}
        onArchiveInvoice={(invoiceId) => runArchiveAction(invoiceId, 'archive')}
        onArchiveRefresh={() => refreshArchiveState({ silent: true })}
      />
    </AppStateProvider>
  )
}
