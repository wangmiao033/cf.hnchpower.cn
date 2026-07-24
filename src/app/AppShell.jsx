import React, { useEffect, useState } from 'react'
import Header from '@/components/layout/Header.jsx'
import Sidebar from '@/components/layout/Sidebar.jsx'
import TopSubnav from '@/components/layout/TopSubnav.jsx'
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
  children
}) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => window.localStorage.getItem('core-sidebar-collapsed') === 'true'
  )

  useEffect(() => {
    window.localStorage.setItem('core-sidebar-collapsed', String(sidebarCollapsed))
  }, [sidebarCollapsed])

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
          <Header activeView={activeView} onNavigate={onNavigate} onSettingsChange={onSettingsChange} />
          <TopSubnav
            activeView={activeView}
            onNavigate={onNavigate}
            openTabs={openTabs}
            onCloseTab={onCloseTab}
          />
          <main className="app-workspace">{children}</main>
        </div>
      </div>
    </div>
  )
}

export default AppShell
