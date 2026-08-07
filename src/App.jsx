import React, {
  lazy,
  Suspense,
  startTransition,
  useCallback,
  useEffect,
  useRef,
  useState
} from 'react'
import './App.css'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import ConfirmDialog from './components/ConfirmDialog.jsx'
import Toast from './components/Toast.jsx'
import { showNotification } from './components/NotificationCenter.jsx'
import { useSettingsStore } from './store/useSettingsStore.js'
import { useReconciliationStore } from './store/useReconciliationStore.js'
import { useInvoiceStore } from './store/useInvoiceStore.js'
import AppShell from './app/AppShell.jsx'
import { AppStateProvider } from './app/AppStateContext.jsx'
import { getGroupForView, getTabView, SIDEBAR_GROUPS, VIEWS } from './app/routes.js'
import { useAuth } from '@/features/auth/AuthContext.jsx'
import {
  apiRowToFrontend,
  getReconciliationRecord
} from '@/lib/api/reconciliation.ts'
import {
  apiChannelRowToFrontend,
  getChannelRecord
} from '@/lib/api/channel.ts'
import { prefetchEditRecord } from '@/lib/api/editRecordCache.js'
import CoreDashboardPage from './pages/CoreDashboardPage.jsx'
import LoginPage from './pages/LoginPage.jsx'
import '@/styles/admin-polish.css'

const PAGE_LOADERS = Object.freeze({
  anomalies: () => import('./pages/AnomalyCenterPage.jsx'),
  coreReconciliation: () => import('./pages/CoreReconciliationPage.jsx'),
  reconciliationProgress: () => import('./pages/RdReconciliationProgressPage.jsx'),
  reconciliationCreate: () => import('./pages/ReconciliationCreatePage.jsx'),
  reconciliationEdit: () => import('./pages/ReconciliationEditPage.jsx'),
  channelReconciliation: () => import('./pages/CoreChannelReconciliationPage.jsx'),
  channelReconciliationCreate: () => import('./pages/ChannelReconciliationCreatePage.jsx'),
  channelReconciliationEdit: () => import('./pages/ChannelReconciliationEditPage.jsx'),
  contracts: () => import('./pages/ContractManagementPage.jsx'),
  invoices: () => import('./pages/InvoicePage.jsx'),
  invoiceCreate: () => import('./pages/InvoiceCreatePage.jsx'),
  invoiceEdit: () => import('./pages/InvoiceEditPage.jsx'),
  quickSdkLibrary: () => import('./pages/QuickSdkLibraryPage.jsx'),
  productSources: () => import('./pages/ProductSourcePage.jsx'),
  quickSdkGroupedData: () => import('./pages/QuickSdkGroupedDataPage.jsx'),
  partners: () => import('./pages/PartnerPage.jsx'),
  userCenter: () => import('./pages/UserCenterPage.jsx')
})

const AnomalyCenterPage = lazy(PAGE_LOADERS.anomalies)
const CoreReconciliationPage = lazy(PAGE_LOADERS.coreReconciliation)
const RdReconciliationProgressPage = lazy(PAGE_LOADERS.reconciliationProgress)
const ReconciliationCreatePage = lazy(PAGE_LOADERS.reconciliationCreate)
const ReconciliationEditPage = lazy(PAGE_LOADERS.reconciliationEdit)
const CoreChannelReconciliationPage = lazy(PAGE_LOADERS.channelReconciliation)
const ChannelReconciliationCreatePage = lazy(PAGE_LOADERS.channelReconciliationCreate)
const ChannelReconciliationEditPage = lazy(PAGE_LOADERS.channelReconciliationEdit)
const ContractManagementPage = lazy(PAGE_LOADERS.contracts)
const InvoicePage = lazy(PAGE_LOADERS.invoices)
const InvoiceCreatePage = lazy(PAGE_LOADERS.invoiceCreate)
const InvoiceEditPage = lazy(PAGE_LOADERS.invoiceEdit)
const QuickSdkLibraryPage = lazy(PAGE_LOADERS.quickSdkLibrary)
const ProductSourcePage = lazy(PAGE_LOADERS.productSources)
const QuickSdkGroupedDataPage = lazy(PAGE_LOADERS.quickSdkGroupedData)
const PartnerPage = lazy(PAGE_LOADERS.partners)
const UserCenterPage = lazy(PAGE_LOADERS.userCenter)

const OPEN_TABS_STORAGE_KEY = 'core-open-workspace-tabs-v2'
const VALID_TAB_VIEWS = new Set(
  SIDEBAR_GROUPS
    .flatMap((group) => group.items.map((item) => item.view))
    .filter((view) => view !== VIEWS.DASHBOARD)
)

function readOpenTabs() {
  if (typeof window === 'undefined') return []

  try {
    const stored = JSON.parse(window.localStorage.getItem(OPEN_TABS_STORAGE_KEY) || '[]')
    if (!Array.isArray(stored)) return []
    return stored.filter((view) => VALID_TAB_VIEWS.has(view))
  } catch {
    return []
  }
}

function scheduleIdleTask(callback) {
  if (typeof window === 'undefined') return () => {}
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(callback, { timeout: 2500 })
    return () => window.cancelIdleCallback?.(id)
  }
  const id = window.setTimeout(callback, 1200)
  return () => window.clearTimeout(id)
}

function App() {
  const { isAuthenticated, loading } = useAuth()
  const [activeView, setActiveViewState] = useState(VIEWS.DASHBOARD)
  const [openTabs, setOpenTabs] = useState(readOpenTabs)
  const [reconEditRecordId, setReconEditRecordId] = useState(null)
  const [reconReturnView, setReconReturnView] = useState(VIEWS.RECON_RD)
  const [channelEditRecordId, setChannelEditRecordId] = useState(null)
  const [channelReturnView, setChannelReturnView] = useState(VIEWS.RECON_CHANNEL)
  const [invoiceEditId, setInvoiceEditId] = useState(null)
  const prevActiveViewRef = useRef(activeView)
  const activeViewRef = useRef(activeView)
  const navigationBlockerRef = useRef(null)
  const [toast, setToast] = useState({ isVisible: false, message: '', type: 'success' })

  const showToast = useCallback((message, type = 'success') => {
    setToast({ isVisible: true, message, type })
    showNotification(message, type, 3000)
  }, [])

  const settings = useSettingsStore({
    showToast,
    enabled: isAuthenticated && !loading
  })
  const recon = useReconciliationStore(settings, showToast, {
    enabled: isAuthenticated && !loading
  })
  const invoice = useInvoiceStore({ showToast, enabled: isAuthenticated && !loading })

  useEffect(() => {
    if (!isAuthenticated || loading) return undefined

    let cancelled = false
    const rdCandidates = (recon.records || []).slice(0, 2)
    const channelCandidates = (recon.channelRecords || []).slice(0, 2)
    const tasks = [
      ...rdCandidates.map((row) => async () => {
        const id = String(row?.id || '')
        if (!id) return
        await prefetchEditRecord('rd', id, async () => {
          const detail = await getReconciliationRecord(id)
          return apiRowToFrontend(detail)
        })
      }),
      ...channelCandidates.map((row) => async () => {
        const id = String(row?.id || '')
        if (!id) return
        await prefetchEditRecord('channel', id, async () => {
          const detail = await getChannelRecord(id)
          return apiChannelRowToFrontend(detail)
        })
      })
    ]

    if (tasks.length === 0) return undefined

    return scheduleIdleTask(() => {
      void (async () => {
        for (const task of tasks) {
          if (cancelled) return
          await task()
          await new Promise((resolve) => window.setTimeout(resolve, 120))
        }
      })()
    })
  }, [isAuthenticated, loading, recon.records, recon.channelRecords])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(OPEN_TABS_STORAGE_KEY, JSON.stringify(openTabs))
  }, [openTabs])

  const setNavigationBlocker = useCallback((blocker) => {
    if (!blocker?.active || !blocker?.view) {
      navigationBlockerRef.current = null
      return
    }
    navigationBlockerRef.current = blocker
  }, [])

  const clearNavigationBlocker = useCallback((view) => {
    const current = navigationBlockerRef.current
    if (!current) return
    if (!view || current.view === view) navigationBlockerRef.current = null
  }, [])

  const confirmLeaveCurrentView = useCallback((nextView) => {
    const blocker = navigationBlockerRef.current
    const currentView = activeViewRef.current
    if (!blocker?.active || blocker.view !== currentView || nextView === currentView) return true
    const confirmed = window.confirm(
      blocker.message || '当前页面还有未保存内容，确定离开吗？'
    )
    if (confirmed) {
      blocker.onConfirm?.()
      navigationBlockerRef.current = null
    }
    return confirmed
  }, [])

  const openView = useCallback((view) => {
    const nextView = view || VIEWS.DASHBOARD
    if (!confirmLeaveCurrentView(nextView)) return false
    const tabView = getTabView(nextView)

    startTransition(() => {
      if (tabView !== VIEWS.DASHBOARD && VALID_TAB_VIEWS.has(tabView)) {
        setOpenTabs((current) => (current.includes(tabView) ? current : [...current, tabView]))
      }
      setActiveViewState(nextView)
    })
    return true
  }, [confirmLeaveCurrentView])

  const setActiveViewRaw = openView
  const navigate = openView

  const closeTab = useCallback((view) => {
    const remainingTabs = openTabs.filter((tab) => tab !== view)
    const closesCurrentView = getTabView(activeView) === view
    if (closesCurrentView && !confirmLeaveCurrentView(VIEWS.DASHBOARD)) return

    startTransition(() => {
      setOpenTabs(remainingTabs)

      if (!closesCurrentView) return

      const group = getGroupForView(view)
      const groupTabs = group.items.map((item) => item.view)
      const closedIndex = groupTabs.indexOf(view)
      const previousTab = [...groupTabs.slice(0, Math.max(closedIndex, 0))]
        .reverse()
        .find((tab) => remainingTabs.includes(tab))
      const nextTab = groupTabs
        .slice(Math.max(closedIndex + 1, 0))
        .find((tab) => remainingTabs.includes(tab))

      setActiveViewState(previousTab || nextTab || VIEWS.DASHBOARD)
    })
  }, [activeView, openTabs, confirmLeaveCurrentView])

  const hideToast = useCallback(() => {
    setToast((t) => ({ ...t, isVisible: false }))
  }, [])

  useEffect(() => {
    activeViewRef.current = activeView
    if (navigationBlockerRef.current?.view !== activeView) {
      navigationBlockerRef.current = null
    }
    if (prevActiveViewRef.current === VIEWS.RECON_EDIT && activeView !== VIEWS.RECON_EDIT) {
      setReconEditRecordId(null)
    }
    if (prevActiveViewRef.current === VIEWS.CHANNEL_RECON_EDIT && activeView !== VIEWS.CHANNEL_RECON_EDIT) {
      setChannelEditRecordId(null)
    }
    if (prevActiveViewRef.current === VIEWS.INVOICE_EDIT && activeView !== VIEWS.INVOICE_EDIT) {
      setInvoiceEditId(null)
    }
    prevActiveViewRef.current = activeView
  }, [activeView])

  const openReconciliationEdit = useCallback((id, returnView = VIEWS.RECON_RD) => {
    const recordId = String(id || '')
    if (recordId) {
      void prefetchEditRecord('rd', recordId, async () => {
        const detail = await getReconciliationRecord(recordId)
        return apiRowToFrontend(detail)
      })
    }
    setReconEditRecordId(recordId)
    setReconReturnView(returnView)
    setActiveViewRaw(VIEWS.RECON_EDIT)
  }, [setActiveViewRaw])

  const openChannelReconciliationEdit = useCallback((id, returnView = VIEWS.RECON_CHANNEL) => {
    const recordId = String(id || '')
    if (recordId) {
      void prefetchEditRecord('channel', recordId, async () => {
        const detail = await getChannelRecord(recordId)
        return apiChannelRowToFrontend(detail)
      })
    }
    setChannelEditRecordId(recordId)
    setChannelReturnView(returnView)
    navigate(VIEWS.CHANNEL_RECON_EDIT)
  }, [navigate])

  const openInvoiceEdit = useCallback((id) => {
    setInvoiceEditId(String(id))
    navigate(VIEWS.INVOICE_EDIT)
  }, [navigate])

  const navigateBankPaymentForReconciliation = useCallback(() => {
    showToast('新版第一阶段仅保留核心对账、流水库和客户库，银行付款入口已暂时收起。', 'info')
  }, [showToast])

  const appCtx = {
    settings,
    recon,
    invoice,
    showToast,
    setActiveView: navigate,
    setActiveViewRaw,
    activeView,
    setNavigationBlocker,
    clearNavigationBlocker,
    reconEditRecordId,
    reconReturnView,
    openReconciliationEdit,
    channelEditRecordId,
    channelReturnView,
    openChannelReconciliationEdit,
    invoiceEditId,
    openInvoiceEdit,
    navigateBankPaymentForReconciliation
  }

  const handleHeaderSettingsChange = (s) => {
    if (s.settlementNumberFormat) {
      settings.setSettlementNumberFormat(s.settlementNumberFormat)
    }
  }

  const renderView = () => {
    switch (activeView) {
      case VIEWS.ANOMALIES:
        return <AnomalyCenterPage />
      case VIEWS.RECON_RD:
        return <CoreReconciliationPage />
      case VIEWS.RECON_PROGRESS:
        return <RdReconciliationProgressPage />
      case VIEWS.RECON_CREATE:
        return <ReconciliationCreatePage />
      case VIEWS.RECON_EDIT:
        return <ReconciliationEditPage />
      case VIEWS.RECON_CHANNEL:
        return <CoreChannelReconciliationPage />
      case VIEWS.CHANNEL_RECON_CREATE:
        return <ChannelReconciliationCreatePage />
      case VIEWS.CHANNEL_RECON_EDIT:
        return <ChannelReconciliationEditPage />
      case VIEWS.CONTRACTS:
        return <ContractManagementPage />
      case VIEWS.INVOICE_MANAGE:
      case VIEWS.INVOICE_INPUT:
        return <InvoicePage section={activeView} />
      case VIEWS.INVOICE_CREATE:
        return <InvoiceCreatePage />
      case VIEWS.INVOICE_EDIT:
        return <InvoiceEditPage />
      case VIEWS.QUICKSDK_LIBRARY:
        return <QuickSdkLibraryPage />
      case VIEWS.PRODUCT_SOURCES:
        return <ProductSourcePage />
      case VIEWS.QUICKSDK_GAMES:
        return <QuickSdkGroupedDataPage dimension="game" />
      case VIEWS.QUICKSDK_CHANNELS:
        return <QuickSdkGroupedDataPage dimension="channel" />
      case VIEWS.PARTNER_CONTACTS:
        return <PartnerPage section={VIEWS.PARTNER_CONTACTS} />
      case VIEWS.USER_CENTER:
        return <UserCenterPage />
      case VIEWS.DASHBOARD:
      default:
        return <CoreDashboardPage />
    }
  }

  if (loading) {
    return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>正在加载登录状态...</div>
  }

  if (!isAuthenticated) {
    return <LoginPage />
  }

  return (
    <ErrorBoundary>
      <AppStateProvider value={appCtx}>
        <AppShell
          activeView={activeView}
          onNavigate={navigate}
          openTabs={openTabs}
          onCloseTab={closeTab}
          onSettingsChange={handleHeaderSettingsChange}
        >
          <Suspense fallback={null}>{renderView()}</Suspense>
        </AppShell>

        <ConfirmDialog
          isOpen={recon.showDeleteConfirm}
          title="确认删除"
          message="确定要删除这条研发对账记录吗？此操作无法撤销。"
          onConfirm={recon.confirmDelete}
          onCancel={recon.cancelDelete}
          confirmText="删除"
          cancelText="取消"
        />

        <ConfirmDialog
          isOpen={recon.showBatchDeleteConfirm}
          title="确认批量删除"
          message={`确定要删除选中的 ${recon.selectedIds.length} 条研发对账记录吗？此操作无法撤销。`}
          onConfirm={recon.confirmBatchDelete}
          onCancel={recon.cancelBatchDelete}
          confirmText="删除"
          cancelText="取消"
        />

        <Toast isVisible={toast.isVisible} message={toast.message} type={toast.type} onClose={hideToast} />
      </AppStateProvider>
    </ErrorBoundary>
  )
}

export default App