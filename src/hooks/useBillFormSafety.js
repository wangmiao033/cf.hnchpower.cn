import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  areNormalizedDraftsEqual,
  billDraftKey,
  clearBillDraft,
  readBillDraft,
  writeBillDraft
} from '@/domain/drafts/billDrafts.js'

function formatTime(timestamp) {
  if (!timestamp) return ''
  try {
    return new Date(timestamp).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    })
  } catch {
    return ''
  }
}

export function useBillFormSafety({
  type,
  title,
  mode,
  view,
  recordId = '',
  initialRecord = null,
  normalize,
  isMeaningful,
  setNavigationBlocker,
  clearNavigationBlocker
}) {
  const draftKey = useMemo(
    () => billDraftKey(type, mode, recordId),
    [type, mode, recordId]
  )
  const baseVersion = useMemo(
    () => (initialRecord ? JSON.stringify(normalize(initialRecord)) : ''),
    [initialRecord, normalize]
  )
  const initialDraft = useMemo(
    () => (mode === 'add' ? readBillDraft(draftKey) : null),
    [mode, draftKey]
  )
  const [currentRecord, setCurrentRecord] = useState(null)
  const [draftRecord, setDraftRecord] = useState(initialDraft?.record || null)
  const [savedAt, setSavedAt] = useState(initialDraft?.savedAt || 0)
  const [restored, setRestored] = useState(Boolean(initialDraft?.record))
  const [staleDraft, setStaleDraft] = useState(false)
  const [resetVersion, setResetVersion] = useState(0)
  const suppressAutosaveRef = useRef(false)

  useEffect(() => {
    if (mode !== 'edit' || !initialRecord || !recordId) return
    const stored = readBillDraft(draftKey)
    if (!stored) {
      setDraftRecord(null)
      setSavedAt(0)
      setRestored(false)
      setStaleDraft(false)
      return
    }
    if (stored.baseVersion && baseVersion && stored.baseVersion !== baseVersion) {
      // Do NOT silently delete a user's unsaved work after a concurrent
      // server-side approval or amendment. Keep the old draft available for
      // recovery, but never auto-apply it to the now-different server bill.
      setDraftRecord(null)
      setSavedAt(stored.savedAt || 0)
      setRestored(false)
      setStaleDraft(true)
      return
    }
    setStaleDraft(false)
    setDraftRecord(stored.record)
    setSavedAt(stored.savedAt)
    setRestored(true)
  }, [mode, initialRecord, recordId, draftKey, baseVersion])

  const dirty = useMemo(() => {
    const candidate = currentRecord || draftRecord
    if (!candidate) return false
    if (mode === 'add') return isMeaningful(candidate)
    if (!initialRecord) return false
    return !areNormalizedDraftsEqual(candidate, initialRecord, normalize)
  }, [currentRecord, draftRecord, mode, initialRecord, normalize, isMeaningful])

  const onFormStateChange = useCallback((record) => {
    setCurrentRecord(record)
    if (suppressAutosaveRef.current) suppressAutosaveRef.current = false
  }, [])

  const flushDraft = useCallback(() => {
    if (!dirty || !currentRecord || suppressAutosaveRef.current) return 0
    const timestamp = writeBillDraft(draftKey, currentRecord, baseVersion)
    if (timestamp) {
      setSavedAt(timestamp)
      setRestored(false)
    }
    return timestamp
  }, [dirty, currentRecord, draftKey, baseVersion])

  useEffect(() => {
    if (!dirty || !currentRecord || suppressAutosaveRef.current) {
      if (!dirty && currentRecord && !staleDraft) {
        clearBillDraft(draftKey)
        setSavedAt(0)
        setRestored(false)
      }
      return undefined
    }

    const timer = window.setTimeout(flushDraft, 650)
    return () => window.clearTimeout(timer)
  }, [dirty, currentRecord, flushDraft, draftKey, staleDraft])

  useEffect(() => {
    if (!dirty) {
      clearNavigationBlocker?.(view)
      return undefined
    }

    setNavigationBlocker?.({
      view,
      active: true,
      message: `${title}还有未保存内容，离开后仍会保留本机草稿，但当前页面修改尚未提交到服务器。确定离开吗？`,
      onConfirm: flushDraft
    })

    return () => clearNavigationBlocker?.(view)
  }, [dirty, title, view, flushDraft, setNavigationBlocker, clearNavigationBlocker])

  useEffect(() => {
    if (!dirty) return undefined
    const onBeforeUnload = (event) => {
      flushDraft()
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty, flushDraft])

  const clearAfterSubmit = useCallback(() => {
    suppressAutosaveRef.current = true
    clearBillDraft(draftKey)
    setCurrentRecord(null)
    setDraftRecord(null)
    setSavedAt(0)
    setRestored(false)
    setStaleDraft(false)
    clearNavigationBlocker?.(view)
  }, [draftKey, clearNavigationBlocker, view])

  const discardDraft = useCallback(() => {
    suppressAutosaveRef.current = true
    clearBillDraft(draftKey)
    setCurrentRecord(null)
    setDraftRecord(null)
    setSavedAt(0)
    setRestored(false)
    setStaleDraft(false)
    setResetVersion((value) => value + 1)
    clearNavigationBlocker?.(view)
  }, [draftKey, clearNavigationBlocker, view])

  const statusText = useMemo(() => {
    if (staleDraft && !dirty) return '服务器版本已更新，旧草稿已保留但未自动覆盖'
    if (!dirty) {
      return mode === 'edit' ? '内容与服务器一致' : '尚未产生本机草稿'
    }
    if (restored && savedAt) return `已恢复 ${formatTime(savedAt)} 的本机草稿`
    if (savedAt) return `草稿已自动保存 ${formatTime(savedAt)}`
    return '检测到未保存内容，正在准备草稿'
  }, [dirty, mode, restored, savedAt, staleDraft])

  return {
    currentRecord,
    draftRecord,
    dirty,
    savedAt,
    restored,
    staleDraft,
    resetVersion,
    statusText,
    onFormStateChange,
    flushDraft,
    clearAfterSubmit,
    discardDraft
  }
}
