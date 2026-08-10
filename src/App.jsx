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
import { canOpenView } from './app/viewPermissions.js'
import { useAuth } from '@/features/auth/AuthContext.jsx'
import { apiRowToFrontend, getReconciliationRecord } from '@/lib/api/reconciliation.ts'
import { apiChannelRowToFrontend, getChannelRecord } from '@/lib/api/channel.ts'
import { prefetchEditRecord } from '@/lib/api/editRecordCache.js'
import CoreDashboardPage from './pages/CoreDashboardPage.jsx'
import LoginPage from './pages/LoginPage.jsx'
import '@/styles/admin-polish.css'

const PAGE_LOADERS = Object.freeze({
  financeWorkbench: () => import('./pages/FinanceWorkbenchPage.jsx'),
  anomalies: () => import('./pages/AnomalyCenterPage.jsx'),
  businessDashboard: () => import('./pages/MonthlyBusinessDashboardPage.jsx'),
  profitAnalysis: () => import('./pages/ProfitAnalysisPage.jsx'),
  bankReconciliation: () => import('./pages/BankAutoReconciliationPage.jsx'),
  bankLedger: () => import('./pages/BankTransactionsLedgerPage.jsx'),
  bankStatementImport: () => import('./pages/BankStatementImportPage.jsx'),
  bill360: () => import('./components/reconciliation/Bill360Drawer.jsx'),
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

const FinanceWorkbenchPage = lazy(PAGE_LOADERS.financeWorkbench)
const AnomalyCenterPage = lazy(PAGE_LOADERS.anomalies)
const MonthlyBusinessDashboardPage = lazy(PAGE_LOADERS.businessDashboard)
const ProfitAnalysisPage = lazy(PAGE_LOADERS.profitAnalysis)
const BankAutoReconciliationPage = lazy(PAGE_LOADERS.bankReconciliation)
const BankTransactionsLedgerPage = lazy(PAGE_LOADERS.bankLedger)
const BankStatementImportPage = lazy(PAGE_LOADERS.bankStatementImport)
const Bill360Drawer = lazy(PAGE_LOADERS.bill360)
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
  SIDEBAR_GROUPS.flatMap((group) => group.items.map((item) => item.view)).filter((view) => view !== VIEWS.DASHBOARD)
)

function readOpenTabs() {
  if (typeof window === 'undefined') return []
  try {
    const stored = JSON.parse(window.localStorage.getItem(OPEN_TABS_STORAGE_KEY) || '[]')
    return Array.isArray(stored) ? stored.filter((view) => VALID_TAB_VIEWS.has(view)) : []
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
  const { user, isAuthenticated, loading, can } = useAuth()
  const [activeView, setActiveViewState] = useState(VIEWS.DASHBOARD)
  const [openTabs, setOpenTabs] = useState(readOpenTabs)
  const [reconEditRecordId, setReconEditRecordId] = useState(null)
  const [reconReturnView, setReconReturnView] = useState(VIEWS.RECON_RD)
  const [channelEditRecordId, setChannelEditRecordId] = useState(null)
  const [channelReturnView, setChannelReturnView] = useState(VIEWS.RECON_CHANNEL)
  const [invoiceEditId, setInvoiceEditId] = useState(null)
  const [bill360Target, setBill360Target] = useState(null)
  const prevActiveViewRef = useRef(activeView)
  const activeViewRef = useRef(activeView)
  const navigationBlockerRef = useRef(null)
  const roleLandingUserRef = useRef('')
  const [toast, setToast] = useState({ isVisible: false, message: '', type: 'success' })

  const showToast = useCallback((message, type = 'success') => {
    setToast({ isVisible: true, message, type })
    showNotification(message, type, 3000)
  }, [])

  const hasReconciliationAccess = isAuthenticated && !loading && can('reconciliation.view')
  const hasInvoiceAccess = isAuthenticated && !loading && can('invoices.view')
  const settings = useSettingsStore({ showToast, enabled: isAuthenticated && !loading })
  const recon = useReconciliationStore(settings, showToast, { enabled: hasReconciliationAccess })
  const invoice = useInvoiceStore({ showToast, enabled: hasInvoiceAccess })

  useEffect(() => {
    if (!isAuthenticated || loading || !user?.id) return
    if (roleLandingUserRef.current === String(user.id)) return
    roleLandingUserRef.current = String(user.id)
    if (user.role === 'finance' && canOpenView(can, VIEWS.FINANCE_WORKBENCH)) {
      setActiveViewState(VIEWS.FINANCE_WORKBENCH)
      setOpenTabs((current) => current.includes(VIEWS.FINANCE_WORKBENCH) ? current : [...current, VIEWS.FINANCE_WORKBENCH])
    }
  }, [isAuthenticated, loading, user?.id, user?.role, can])

  useEffect(() => {
    if (!hasReconciliationAccess) return undefined
    let cancelled = false
    const tasks = [
      ...(recon.records || []).slice(0, 2).map((row) => async () => {
        const id = String(row?.id || '')
        if (!id) return
        await prefetchEditRecord('rd', id, async () => apiRowToFrontend(await getReconciliationRecord(id)))
      }),
      ...(recon.channelRecords || []).slice(0, 2).map((row) => async () => {
        const id = String(row?.id || '')
        if (!id) return
        await prefetchEditRecord('channel', id, async () => apiChannelRowToFrontend(await getChannelRecord(id)))
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
  }, [hasReconciliationAccess, recon.records, recon.channelRecords])

  useEffect(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem(OPEN_TABS_STORAGE_KEY, JSON.stringify(openTabs))
  }, [openTabs])

  useEffect(() => {
    if (!isAuthenticated || loading) return
    setOpenTabs((current) => current.filter((view) => canOpenView(can, view)))
    if (!canOpenView(can, activeView)) {
      navigationBlockerRef.current = null
      setActiveViewState(user?.role === 'finance' && canOpenView(can, VIEWS.FINANCE_WORKBENCH) ? VIEWS.FINANCE_WORKBENCH : VIEWS.DASHBOARD)
      setBill360Target(null)
    }
  }, [isAuthenticated, loading, can, activeView, user?.role])

  const setNavigationBlocker = useCallback((blocker) => {
    navigationBlockerRef.current = blocker?.active && blocker?.view ? blocker : null
  }, [])

  const clearNavigationBlocker = useCallback((view) => {
    const current = navigationBlockerRef.current
    if (current && (!view || current.view === view)) navigationBlockerRef.current = null
  }, [])

  const confirmLeaveCurrentView = useCallback((nextView) => {
    const blocker = navigationBlockerRef.current
    const currentView = activeViewRef.current
    if (!blocker?.active || blocker.view !== currentView || nextView === currentView) return true
    const confirmed = window.confirm(blocker.message || '当前页面还有未保存内容，确定离开吗？')
    if (confirmed) {
      blocker.onConfirm?.()
      navigationBlockerRef.current = null
    }
    return confirmed
  }, [])

  const openView = useCallback((view) => {
    const nextView = view || VIEWS.DASHBOARD
    if (!canOpenView(can, nextView)) {
      showToast('当前账号没有访问该模块的权限', 'error')
      return false
    }
    if (!confirmLeaveCurrentView(nextView)) return false
    const tabView = getTabView(nextView)
    startTransition(() => {
      if (tabView !== VIEWS.DASHBOARD && VALID_TAB_VIEWS.has(tabView)) {
        setOpenTabs((current) => (current.includes(tabView) ? current : [...current, tabView]))
      }
      setActiveViewState(nextView)
    })
    return true
  }, [can, confirmLeaveCurrentView, showToast])

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
      const previousTab = [...groupTabs.slice(0, Math.max(closedIndex, 0))].reverse().find((tab) => remainingTabs.includes(tab) && canOpenView(can, tab))
      const nextTab = groupTabs.slice(Math.max(closedIndex + 1, 0)).find((tab) => remainingTabs.includes(tab) && canOpenView(can, tab))
      setActiveViewState(previousTab || nextTab || (user?.role === 'finance' ? VIEWS.FINANCE_WORKBENCH : VIEWS.DASHBOARD))
    })
  }, [activeView, openTabs, confirmLeaveCurrentView, can, user?.role])

  const hideToast = useCallback(() => setToast((t) => ({ ...t, isVisible: false })), [])

  useEffect(() => {
    activeViewRef.current = activeView
    if (navigationBlockerRef.current?.view !== activeView) navigationBlockerRef.current = null
    if (prevActiveViewRef.current === VIEWS.RECON_EDIT && activeView !== VIEWS.RECON_EDIT) setReconEditRecordId(null)
    if (prevActiveViewRef.current === VIEWS.CHANNEL_RECON_EDIT && activeView !== VIEWS.CHANNEL_RECON_EDIT) setChannelEditRecordId(null)
    if (prevActiveViewRef.current === VIEWS.INVOICE_EDIT && activeView !== VIEWS.INVOICE_EDIT) setInvoiceEditId(null)
    prevActiveViewRef.current = activeView
  }, [activeView])

  const openReconciliationEdit = useCallback((id, returnView = VIEWS.RECON_RD) => {
    const recordId = String(id || '')
    if (recordId) void prefetchEditRecord('rd', recordId, async () => apiRowToFrontend(await getReconciliationRecord(recordId)))
    setReconEditRecordId(recordId)
    setReconReturnView(returnView)
    setActiveViewRaw(VIEWS.RECON_EDIT)
  }, [setActiveViewRaw])

  const openChannelReconciliationEdit = useCallback((id, returnView = VIEWS.RECON_CHANNEL) => {
    const recordId = String(id || '')
    if (recordId) void prefetchEditRecord('channel', recordId, async () => apiChannelRowToFrontend(await getChannelRecord(recordId)))
    setChannelEditRecordId(recordId)
    setChannelReturnView(returnView)
    navigate(VIEWS.CHANNEL_RECON_EDIT)
  }, [navigate])

  const openBill360 = useCallback((billType, id, initialRecord = null) => {
    if (!can('reconciliation.view')) {
      showToast('当前账号没有查看账单详情的权限', 'error')
      return
    }
    const billId = String(id || '')
    if (billId) setBill360Target({ billType: billType === 'channel' ? 'channel' : 'rd', billId, initialRecord })
  }, [can, showToast])

  const closeBill360 = useCallback(() => setBill360Target(null), [])
  const openInvoiceEdit = useCallback((id) => { setInvoiceEditId(String(id)); navigate(VIEWS.INVOICE_EDIT) }, [navigate])
  const navigateBankPaymentForReconciliation = useCallback(() => navigate(VIEWS.BANK_RECONCILIATION), [navigate])

  const appCtx = {
    settings, recon, invoice, showToast,
    setActiveView: navigate, setActiveViewRaw, activeView,
    setNavigationBlocker, clearNavigationBlocker,
    reconEditRecordId, reconReturnView, openReconciliationEdit,
    channelEditRecordId, channelReturnView, openChannelReconciliationEdit,
    openBill360, invoiceEditId, openInvoiceEdit, navigateBankPaymentForReconciliation
  }

  const handleHeaderSettingsChange = (s) => {
    if (s.settlementNumberFormat) settings.setSettlementNumberFormat(s.settlementNumberFormat)
  }

  const renderView = () => {
    if (!canOpenView(can, activeView)) return <CoreDashboardPage />
    switch (activeView) {
      case VIEWS.FINANCE_WORKBENCH: return <FinanceWorkbenchPage />
      case VIEWS.ANOMALIES: return <AnomalyCenterPage />
      case VIEWS.BUSINESS_DASHBOARD: return <MonthlyBusinessDashboardPage />
      case VIEWS.PROFIT_ANALYSIS: return <ProfitAnalysisPage />
      case VIEWS.BANK_RECONCILIATION: return <BankAutoReconciliationPage />
      case VIEWS.BANK_TRANSACTIONS_LEDGER: return <BankTransactionsLedgerPage />
      case VIEWS.BANK_STATEMENT_IMPORT: return <BankStatementImportPage />
      case VIEWS.RECON_RD: return <CoreReconciliationPage />
      case VIEWS.RECON_PROGRESS: return <RdReconciliationProgressPage />
      case VIEWS.RECON_CREATE: return <ReconciliationCreatePage />
      case VIEWS.RECON_EDIT: return <ReconciliationEditPage />
      case VIEWS.RECON_CHANNEL: return <CoreChannelReconciliationPage />
      case VIEWS.CHANNEL_RECON_CREATE: return <ChannelReconciliationCreatePage />
      case VIEWS.CHANNEL_RECON_EDIT: return <ChannelReconciliationEditPage />
      case VIEWS.CONTRACTS: return <ContractManagementPage />
      case VIEWS.INVOICE_MANAGE:
      case VIEWS.INVOICE_INPUT: return <InvoicePage section={activeView} />
      case VIEWS.INVOICE_CREATE: return <InvoiceCreatePage />
      case VIEWS.INVOICE_EDIT: return <InvoiceEditPage />
      case VIEWS.QUICKSDK_LIBRARY: return <QuickSdkLibraryPage />
      case VIEWS.PRODUCT_SOURCES: return <ProductSourcePage />
      case VIEWS.QUICKSDK_GAMES: return <QuickSdkGroupedDataPage dimension="game" />
      case VIEWS.QUICKSDK_CHANNELS: return <QuickSdkGroupedDataPage dimension="channel" />
      case VIEWS.PARTNER_CONTACTS: return <PartnerPage section={VIEWS.PARTNER_CONTACTS} />
      case VIEWS.USER_CENTER: return <UserCenterPage />
      case VIEWS.DASHBOARD:
      default: return <CoreDashboardPage />
    }
  }

  if (loading) return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>正在加载登录状态...</div>
  if (!isAuthenticated) return <LoginPage />

  return (
    <ErrorBoundary>
      <AppStateProvider value={appCtx}>
        <AppShell activeView={activeView} onNavigate={navigate} openTabs={openTabs} onCloseTab={closeTab} onSettingsChange={handleHeaderSettingsChange}>
          <Suspense fallback={null}>{renderView()}</Suspense>
        </AppShell>
        {bill360Target ? <Suspense fallback={null}><Bill360Drawer target={bill360Target} onClose={closeBill360} /></Suspense> : null}
        <ConfirmDialog isOpen={recon.showDeleteConfirm} title="确认删除" message="确定要删除这条研发对账记录吗？此操作无法撤销。" onConfirm={recon.confirmDelete} onCancel={recon.cancelDelete} confirmText="删除" cancelText="取消" />
        <ConfirmDialog isOpen={recon.showBatchDeleteConfirm} title="确认批量删除" message={`确定要删除选中的 ${recon.selectedIds.length} 条研发对账记录吗？此操作无法撤销。`} onConfirm={recon.confirmBatchDelete} onCancel={recon.cancelBatchDelete} confirmText="删除" cancelText="取消" />
        <Toast isVisible={toast.isVisible} message={toast.message} type={toast.type} onClose={hideToast} />
      </AppStateProvider>
    </ErrorBoundary>
  )
}

export default App
