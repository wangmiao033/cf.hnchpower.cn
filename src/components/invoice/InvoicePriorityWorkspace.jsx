import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { AppStateProvider, useAppState } from '@/app/AppStateContext.jsx'
import {
  autoMatchInvoices,
  INVOICE_ARCHIVE_SYNC_EVENT
} from '@/lib/api/billInvoiceAllocations.ts'
import { getInvoiceRecordId } from '@/lib/api/invoice.ts'
import {
  archiveInvoiceRecord,
  getInvoiceArchiveSnapshot,
  syncInvoiceArchiveRecords,
  unarchiveInvoiceRecord
} from '@/lib/api/invoiceArchive.ts'
import { sortInvoicesByMatchScore } from '@/domain/invoice/invoiceMatchPriority.js'
import InvoiceArchiveWorkspace from './InvoiceArchiveWorkspace.jsx'
import InvoiceManageWorkspace from './InvoiceManageWorkspace.jsx'
import './invoice-archive-ui.css'

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

const EMPTY_ARCHIVE_SNAPSHOT = {
  archived_ids: [],
  held_ids: [],
  archived_count: 0,
  held_count: 0,
  items: []
}

export default function InvoicePriorityWorkspace({ variant = 'manage', direction = 'output' }) {
  const appState = useAppState()
  const filteredInvoices = appState.invoice?.filteredInvoices || []
  const invoiceApiEnabled = Boolean(appState.invoice?.invoiceApiEnabled)
  const showToast = appState.showToast
  const [scoreById, setScoreById] = useState({})
  const [archiveScope, setArchiveScope] = useState('active')
  const [archiveSnapshot, setArchiveSnapshot] = useState(EMPTY_ARCHIVE_SNAPSHOT)
  const [archiveBusyId, setArchiveBusyId] = useState('')

  const archivedIdSet = useMemo(
    () => new Set((archiveSnapshot.archived_ids || []).map(String)),
    [archiveSnapshot.archived_ids]
  )

  const activeInvoices = useMemo(
    () => filteredInvoices.filter((item) => !archivedIdSet.has(recordId(item))),
    [archivedIdSet, filteredInvoices]
  )
  const archivedInvoices = useMemo(
    () => filteredInvoices.filter((item) => archivedIdSet.has(recordId(item))),
    [archivedIdSet, filteredInvoices]
  )

  const refreshArchiveSnapshot = useCallback(async ({ sync = false, silent = true } = {}) => {
    if (!invoiceApiEnabled) return null
    try {
      const snapshot = sync
        ? await syncInvoiceArchiveRecords()
        : await getInvoiceArchiveSnapshot()
      setArchiveSnapshot(snapshot)
      if (!silent && sync && (snapshot.auto_archived || snapshot.auto_reopened)) {
        showToast?.(
          `发票归档已同步：归档 ${snapshot.auto_archived || 0} 张，恢复 ${snapshot.auto_reopened || 0} 张`,
          'success'
        )
      }
      return snapshot
    } catch (error) {
      console.error(error)
      if (!silent) showToast?.('发票归档状态同步失败，请稍后重试', 'error')
      return null
    }
  }, [invoiceApiEnabled, showToast])

  useEffect(() => {
    if (!invoiceApiEnabled) {
      setArchiveSnapshot(EMPTY_ARCHIVE_SNAPSHOT)
      return
    }
    void refreshArchiveSnapshot({ sync: true, silent: true })
  }, [invoiceApiEnabled, refreshArchiveSnapshot])

  useEffect(() => {
    if (!invoiceApiEnabled) return undefined
    const handleArchiveSync = () => {
      void refreshArchiveSnapshot({ sync: true, silent: true })
    }
    window.addEventListener(INVOICE_ARCHIVE_SYNC_EVENT, handleArchiveSync)
    return () => window.removeEventListener(INVOICE_ARCHIVE_SYNC_EVENT, handleArchiveSync)
  }, [invoiceApiEnabled, refreshArchiveSnapshot])

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

  const runArchiveAction = useCallback(async (invoiceId, action) => {
    if (!invoiceApiEnabled || !invoiceId || archiveBusyId) return
    setArchiveBusyId(String(invoiceId))
    try {
      if (action === 'unarchive') {
        await unarchiveInvoiceRecord(String(invoiceId))
        await refreshArchiveSnapshot({ sync: false, silent: true })
        showToast?.('已取消归档，发票已回到待处理区', 'success')
      } else {
        await archiveInvoiceRecord(String(invoiceId))
        await refreshArchiveSnapshot({ sync: false, silent: true })
        showToast?.('发票已重新归档', 'success')
      }
    } catch (error) {
      console.error(error)
      const message = error?.data?.detail?.message || error?.message || '归档操作失败'
      showToast?.(message, 'error')
    } finally {
      setArchiveBusyId('')
    }
  }, [archiveBusyId, invoiceApiEnabled, refreshArchiveSnapshot, showToast])

  const nestedState = useMemo(
    () => ({
      ...appState,
      invoice: {
        ...appState.invoice,
        filteredInvoices: prioritizedActiveInvoices
      }
    }),
    [appState, prioritizedActiveInvoices]
  )

  return (
    <>
      <div className="invoice-archive-nav" aria-label="发票处理状态">
        <button
          type="button"
          className={archiveScope === 'active' ? 'is-active' : ''}
          onClick={() => setArchiveScope('active')}
        >
          待处理 <strong>{activeInvoices.length}</strong>
        </button>
        <button
          type="button"
          className={archiveScope === 'archived' ? 'is-active' : ''}
          onClick={() => setArchiveScope('archived')}
        >
          已归档 <strong>{archivedInvoices.length}</strong>
        </button>
        <span>完整关联且无异常的发票自动进入归档</span>
      </div>

      {archiveScope === 'active' ? (
        <AppStateProvider value={nestedState}>
          <InvoiceManageWorkspace variant={variant} direction={direction} />
        </AppStateProvider>
      ) : (
        <InvoiceArchiveWorkspace
          invoices={archivedInvoices}
          direction={direction}
          archiveItems={archiveSnapshot.items || []}
          archiveBusyId={archiveBusyId}
          onUnarchive={(invoiceId) => runArchiveAction(invoiceId, 'unarchive')}
        />
      )}
    </>
  )
}
