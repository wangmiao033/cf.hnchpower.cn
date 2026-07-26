import React, { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import './App.css'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import ConfirmDialog from './components/ConfirmDialog.jsx'
import Toast from './components/Toast.jsx'
import { showNotification } from './components/NotificationCenter.jsx'
import { useSettingsStore } from './store/useSettingsStore.js'
import { useReconciliationStore } from './store/useReconciliationStore.js'
import AppShell from './app/AppShell.jsx'
import { AppStateProvider } from './app/AppStateContext.jsx'
import { getGroupForView, getTabView, SIDEBAR_GROUPS, VIEWS } from './app/routes.js'
import { useAuth } from '@/features/auth/AuthContext.jsx'
import '@/styles/admin-polish.css'

const CoreDashboardPage = lazy(() => import('./pages/CoreDashboardPage.jsx'))
const CoreReconciliationPage = lazy(() => import('./pages/CoreReconciliationPage.jsx'))
const ReconciliationCreatePage = lazy(() => import('./pages/ReconciliationCreatePage.jsx'))
const ReconciliationEditPage = lazy(() => import('./pages/ReconciliationEditPage.jsx'))
const CoreChannelReconciliationPage = lazy(() => import('./pages/CoreChannelReconciliationPage.jsx'))
const ChannelReconciliationCreatePage = lazy(() => import('./pages/ChannelReconciliationCreatePage.jsx'))
const ChannelReconciliationEditPage = lazy(() => import('./pages/ChannelReconciliationEditPage.jsx'))
const QuickSdkLibraryPage = lazy(() => import('./pages/QuickSdkLibraryPage.jsx'))
const PartnerPage = lazy(() => import('./pages/PartnerPage.jsx'))
const UserCenterPage = lazy(() => import('./pages/UserCenterPage.jsx'))
const LoginPage = lazy(() => import('./pages/LoginPage.jsx'))

function PageLoading() {
  return (
    <div style={{ minHeight: '40vh', display: 'grid', placeItems: 'center' }}>
      正在加载...
    </div>
  )
}

function App() {
  const { isAuthenticated, loading } = useAuth()
  const [activeView, setActiveViewRaw] = useState(VIEWS.DASHBOARD)
  const [openTabs, setOpenTabs] = useState(() =>
    SIDEBAR_GROUPS
      .filter((group) => group.id !== 'workbench')
      .flatMap((group) => group.items.map((item) => item.view))
  )
  const [reconEditRecordId, setReconEditRecordId] = useState(null)
  const [channelEditRecordId, setChannelEditRecordId] = useState(null)
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

  const navigate = useCallback((view) => {
    const nextView = view || VIEWS.DASHBOARD
    const tabView = getTabView(nextView)

    if (tabView !== VIEWS.DASHBOARD) {
      setOpenTabs((current) => (current.includes(tabView) ? current : [...current, tabView]))
    }

    setActiveViewRaw(nextView)
  }, [])

  const closeTab = useCallback((view) => {
    const remainingTabs = openTabs.filter((tab) => tab !== view)
    setOpenTabs(remainingTabs)

    if (getTabView(activeView) !== view) {
      return
    }

    const group = getGroupForView(view)
    const groupTabs = group.items.map((item) => item.view)
    const closedIndex = groupTabs.indexOf(view)
    const previousTab = [...groupTabs.slice(0, Math.max(closedIndex, 0))]
      .reverse()
      .find((tab) => remainingTabs.includes(tab))
    const nextTab = groupTabs
      .slice(Math.max(closedIndex + 1, 0))
      .find((tab) => remainingTabs.includes(tab))

    setActiveViewRaw(previousTab || nextTab || VIEWS.DASHBOARD)
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
    prevActiveViewRef.current = activeView
  }, [activeView])

  const openReconciliationEdit = useCallback((id) => {
    setReconEditRecordId(id)
    setActiveViewRaw(VIEWS.RECON_EDIT)
  }, [])

  const openChannelReconciliationEdit = useCallback((id) => {
    setChannelEditRecordId(id)
    setActiveViewRaw(VIEWS.CHANNEL_RECON_EDIT)
  }, [])

  const navigateBankPaymentForReconciliation = useCallback(() => {
    showToast('新版第一阶段仅保留核心对账、流水库和客户库，银行付款入口已暂时收起。', 'info')
  }, [showToast])

  const appCtx = {
    settings,
    recon,
    invoice: {},
    showToast,
    setActiveView: navigate,
    setActiveViewRaw,
    activeView,
    reconEditRecordId,
    openReconciliationEdit,
    channelEditRecordId,
    openChannelReconciliationEdit,
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
      case VIEWS.QUICKSDK_LIBRARY:
        return <QuickSdkLibraryPage />
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
    return (
      <Suspense fallback={<PageLoading />}>
        <LoginPage />
      </Suspense>
    )
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
          <Suspense fallback={<PageLoading />}>{renderView()}</Suspense>
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
