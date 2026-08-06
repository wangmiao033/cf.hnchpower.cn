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
  const [resetVersion, setResetVersion] = useState(0)
  const suppressAutosaveRef = useRef(false)

  useEffect(() => {
    if (mode !== 'edit' || !initialRecord || !recordId) return
    const stored = readBillDraft(draftKey)
    if (!stored) {
      setDraftRecord(null)
      setSavedAt(0)
      setRestored(false)
      return
    }
    if (stored.baseVersion && baseVersion && stored.baseVersion !== baseVersion) {
      clearBillDraft(draftKey)
      setDraftRecord(null)
      setSavedAt(0)
      setRestored(false)
      return
    }
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

  useEffect(() => {
    if (!dirty || !currentRecord || suppressAutosaveRef.current) {
      if (!dirty && currentRecord) {
        clearBillDraft(draftKey)
        setSavedAt(0)
        setRestored(false)
      }
      return undefined
    }

    const timer = window.setTimeout(() => {
      const timestamp = writeBillDraft(draftKey, currentRecord, baseVersion)
      if (timestamp) {
        setSavedAt(timestamp)
        setRestored(false)
      }
    }, 650)

    return () => window.clearTimeout(timer)
  }, [dirty, currentRecord, draftKey, baseVersion])

  useEffect(() => {
    if (!dirty) {
      clearNavigationBlocker?.(view)
      return undefined
    }

    setNavigationBlocker?.({
      view,
      active: true,
      message: `${title}还有未保存内容，离开后仍会保留本机草稿，但当前页面修改尚未提交到服务器。确定离开吗？`
    })

    return () => clearNavigationBlocker?.(view)
  }, [dirty, title, view, setNavigationBlocker, clearNavigationBlocker])

  useEffect(() => {
    if (!dirty) return undefined
    const onBeforeUnload = (event) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  const clearAfterSubmit = useCallback(() => {
    suppressAutosaveRef.current = true
    clearBillDraft(draftKey)
    setCurrentRecord(null)
    setDraftRecord(null)
    setSavedAt(0)
    setRestored(false)
    clearNavigationBlocker?.(view)
  }, [draftKey, clearNavigationBlocker, view])

  const discardDraft = useCallback(() => {
    suppressAutosaveRef.current = true
    clearBillDraft(draftKey)
    setCurrentRecord(null)
    setDraftRecord(null)
    setSavedAt(0)
    setRestored(false)
    setResetVersion((value) => value + 1)
    clearNavigationBlocker?.(view)
  }, [draftKey, clearNavigationBlocker, view])

  const statusText = useMemo(() => {
    if (!dirty) {
      return mode === 'edit' ? '内容与服务器一致' : '尚未产生本机草稿'
    }
    if (restored && savedAt) return `已恢复 ${formatTime(savedAt)} 的本机草稿`
    if (savedAt) return `草稿已自动保存 ${formatTime(savedAt)}`
    return '检测到未保存内容，正在准备草稿'
  }, [dirty, mode, restored, savedAt])

  return {
    draftRecord,
    dirty,
    savedAt,
    restored,
    resetVersion,
    statusText,
    onFormStateChange,
    clearAfterSubmit,
    discardDraft
  }
}
