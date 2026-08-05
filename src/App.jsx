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
import CoreDashboardPage from './pages/CoreDashboardPage.jsx'
import LoginPage from './pages/LoginPage.jsx'
import '@/styles/admin-polish.css'

const PAGE_LOADERS = Object.freeze({
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

function preloadAuthenticatedPages() {
  Object.values(PAGE_LOADERS).forEach((loadPage) => {
    void loadPage().catch((error) => {
      console.warn('页面预加载失败，将在打开时重试。', error)
    })
  })
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

    const timer = window.setTimeout(preloadAuthenticatedPages, 0)
    return () => window.clearTimeout(timer)
  }, [isAuthenticated, loading])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(OPEN_TABS_STORAGE_KEY, JSON.stringify(openTabs))
  }, [openTabs])

  const openView = useCallback((view) => {
    const nextView = view || VIEWS.DASHBOARD
    const tabView = getTabView(nextView)

    startTransition(() => {
      if (tabView !== VIEWS.DASHBOARD && VALID_TAB_VIEWS.has(tabView)) {
        setOpenTabs((current) => (current.includes(tabView) ? current : [...current, tabView]))
      }
      setActiveViewState(nextView)
    })
  }, [])

  const setActiveViewRaw = openView
  const navigate = openView

  const closeTab = useCallback((view) => {
    const remainingTabs = openTabs.filter((tab) => tab !== view)

    startTransition(() => {
      setOpenTabs(remainingTabs)

      if (getTabView(activeView) !== view) return

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
  }, [activeView, openTabs])

  const hideToast = useCallback(() => {
    setToast((t) => ({ ...t, isVisible: false }))
  }, [])

  useEffect(() => {
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
    setReconEditRecordId(id)
    setReconReturnView(returnView)
    setActiveViewRaw(VIEWS.RECON_EDIT)
  }, [setActiveViewRaw])

  const openChannelReconciliationEdit = useCallback((id, returnView = VIEWS.RECON_CHANNEL) => {
    setChannelEditRecordId(id)
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
