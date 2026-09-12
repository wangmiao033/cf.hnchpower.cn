import React, { useEffect, useState } from 'react'
import Header from '@/components/layout/Header.jsx'
import Sidebar from '@/components/layout/Sidebar.jsx'
import TopSubnav from '@/components/layout/TopSubnav.jsx'
import ContractSmartIntakeLauncher, { CONTRACT_SMART_SAVED_EVENT } from '@/components/contract/ContractSmartIntakeLauncher.jsx'
import ChannelQuickReconcileLauncher from '@/components/channel/ChannelQuickReconcileLauncher.jsx'
import { VIEWS } from '@/app/routes.js'
import './AppShell.css'

/**
 * 标准后台骨架：左侧固定导航 + 右侧（顶栏 + 全宽工作区）
 * 不再使用「整页居中大白盒」包裹。
 */
function AppShell({
  activeView,
  onNavigate,
  openTabs,
  onCloseTab,
  onSettingsChange,
  dataConnectionWarning,
  dataConnectionDetail,
  onRetryDataConnection,
  children
}) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => window.localStorage.getItem('core-sidebar-collapsed') === 'true'
  )
  const [contractRefreshKey, setContractRefreshKey] = useState(0)

  useEffect(() => {
    window.localStorage.setItem('core-sidebar-collapsed', String(sidebarCollapsed))
  }, [sidebarCollapsed])

  useEffect(() => {
    const refreshContractWorkspace = () => setContractRefreshKey((value) => value + 1)
    window.addEventListener(CONTRACT_SMART_SAVED_EVENT, refreshContractWorkspace)
    return () => window.removeEventListener(CONTRACT_SMART_SAVED_EVENT, refreshContractWorkspace)
  }, [])

  return (
    <div className="app">
      <div className="app-dashboard">
        <Sidebar
          activeView={activeView}
          onNavigate={onNavigate}
          collapsed={sidebarCollapsed}
        />
        <div
          className={`sidebar-toggle-rail ${sidebarCollapsed ? 'is-collapsed' : ''}`}
          aria-hidden="false"
        >
          <button
            type="button"
            className="sidebar-rail-button"
            onClick={() => setSidebarCollapsed((value) => !value)}
            aria-label={sidebarCollapsed ? '展开侧边栏' : '折叠侧边栏'}
            title={sidebarCollapsed ? '展开侧边栏' : '折叠侧边栏'}
          >
            <span aria-hidden>{sidebarCollapsed ? '›' : '‹'}</span>
          </button>
        </div>
        <div className="app-main-shell">
          <Header
            activeView={activeView}
            onNavigate={onNavigate}
            onSettingsChange={onSettingsChange}
          />
          <TopSubnav
            activeView={activeView}
            onNavigate={onNavigate}
            openTabs={openTabs}
            onCloseTab={onCloseTab}
          />
          {dataConnectionWarning ? (
            <div className="app-data-connection-warning" role="status">
              <div>
                <strong>当前显示浏览器缓存数据</strong>
                <span>{dataConnectionDetail || '账单服务器数据暂时不可用'}。这些内容可能不是服务器最新状态，请恢复连接后再执行关键财务操作。</span>
              </div>
              <button type="button" onClick={onRetryDataConnection}>重新连接</button>
            </div>
          ) : null}
          <main className="app-workspace">
            <React.Fragment key={activeView === VIEWS.CONTRACTS ? `contracts-${contractRefreshKey}` : activeView}>
              {children}
            </React.Fragment>
          </main>
          {activeView === VIEWS.RECON_CHANNEL ? <ChannelQuickReconcileLauncher /> : null}
          {activeView === VIEWS.CONTRACTS ? <ContractSmartIntakeLauncher /> : null}
        </div>
      </div>
    </div>
  )
}

export default AppShell