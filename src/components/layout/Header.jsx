import React, { useEffect, useMemo, useRef, useState } from 'react'
import NotificationCenter from '@/components/NotificationCenter.jsx'
import Settings from '@/components/Settings.jsx'
import HelpTooltip from '@/components/HelpTooltip.jsx'
import MobileMenu from '@/components/MobileMenu.jsx'
import ConfirmDialog from '@/components/ConfirmDialog.jsx'
import GlobalSearch from '@/components/search/GlobalSearch.jsx'
import { getPageMeta, getTabView, SIDEBAR_GROUPS, VIEWS } from '@/app/routes.js'
import { canOpenView } from '@/app/viewPermissions.js'
import { useAuth } from '@/features/auth/AuthContext.jsx'
import './Header.css'

function Header({ activeView, onNavigate, onSettingsChange }) {
  const { user, signOut, can } = useAuth()
  const pageMeta = getPageMeta(activeView)
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [showLogoutDialog, setShowLogoutDialog] = useState(false)
  const userMenuRef = useRef(null)
  const accountLabel = user?.display_name || user?.email || '当前用户'
  const accountDetail = user?.email && user.email !== accountLabel ? user.email : '系统管理员'
  const accountInitial = accountLabel.trim().slice(0, 1).toUpperCase() || 'U'
  const activeTabView = getTabView(activeView)
  const mobileGroups = useMemo(
    () => SIDEBAR_GROUPS
      .map((group) => ({ ...group, items: group.items.filter((item) => canOpenView(can, item.view)) }))
      .filter((group) => group.items.length > 0),
    [can]
  )

  useEffect(() => {
    if (!showUserMenu) return undefined
    const handlePointerDown = (event) => {
      if (!userMenuRef.current?.contains(event.target)) setShowUserMenu(false)
    }
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setShowUserMenu(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [showUserMenu])

  return (
    <header className="app-admin-header">
      <div className="app-admin-header__toolbar">
        <div className="app-admin-header__left">
          <div className="app-admin-header__mobile">
            <MobileMenu>
              <nav className="header-mobile-sidebar" aria-label="移动端主导航">
                {mobileGroups.map((group) => (
                  <div key={group.id} className="header-mobile-group">
                    <div className="header-mobile-group-label">{group.label}</div>
                    {group.items.map((item) => {
                      const active = item.view === activeTabView
                      return (
                        <button
                          key={item.view}
                          type="button"
                          aria-current={active ? 'page' : undefined}
                          className={`header-mobile-item ${active ? 'active' : ''}`}
                          onClick={() => onNavigate?.(item.view)}
                        >
                          {item.label}
                        </button>
                      )
                    })}
                  </div>
                ))}
              </nav>
            </MobileMenu>
          </div>
          <div className="app-admin-header__title-block">
            <strong>{pageMeta.title}</strong>
            <span>{pageMeta.description}</span>
          </div>
        </div>
        <div className="app-admin-header__right">
          <GlobalSearch />
          <div className="app-admin-header__utility-group" role="group" aria-label="工作区工具">
            <NotificationCenter />
            <HelpTooltip />
            <Settings onSettingsChange={onSettingsChange} />
          </div>
          <div className="app-admin-header__user-wrap" ref={userMenuRef}>
            <button
              type="button"
              className={`app-admin-header__user ${showUserMenu ? 'is-open' : ''}`}
              title={user?.email || '用户'}
              aria-label="打开账号菜单"
              aria-haspopup="menu"
              aria-expanded={showUserMenu}
              aria-controls="app-account-menu"
              onClick={() => setShowUserMenu((v) => !v)}
            >
              <span className="app-admin-header__user-avatar" aria-hidden="true">{accountInitial}</span>
              <span className="app-admin-header__user-name">{accountLabel}</span>
              <svg className="app-admin-header__user-chevron" viewBox="0 0 16 16" aria-hidden="true">
                <path d="m4.5 6 3.5 3.5L11.5 6" />
              </svg>
            </button>
            {showUserMenu ? (
              <div id="app-account-menu" className="app-admin-header__user-menu" role="menu" aria-label="账号操作">
                <div className="app-admin-header__user-profile">
                  <span className="app-admin-header__profile-avatar" aria-hidden="true">{accountInitial}<i /></span>
                  <span className="app-admin-header__profile-copy">
                    <small>当前登录账号</small><strong>{accountLabel}</strong><span>{accountDetail}</span>
                  </span>
                </div>
                <div className="app-admin-header__user-actions">
                  <p>账号设置</p>
                  <button type="button" role="menuitem" className="app-admin-header__user-menu-item" onClick={() => { setShowUserMenu(false); onNavigate?.(VIEWS.USER_CENTER) }}>
                    <span className="app-admin-header__menu-icon" aria-hidden="true">
                      <svg viewBox="0 0 20 20"><circle cx="10" cy="7" r="3.2" /><path d="M4.2 16c.8-3 2.7-4.5 5.8-4.5s5 1.5 5.8 4.5" /></svg>
                    </span>
                    <span><strong>用户中心</strong><small>账号信息、密码与登录安全</small></span>
                    <svg className="app-admin-header__menu-arrow" viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3.5 4.5 4.5L6 12.5" /></svg>
                  </button>
                </div>
                <div className="app-admin-header__user-danger">
                  <button type="button" role="menuitem" className="app-admin-header__user-menu-item danger" onClick={() => { setShowUserMenu(false); setShowLogoutDialog(true) }}>
                    <span className="app-admin-header__menu-icon" aria-hidden="true">
                      <svg viewBox="0 0 20 20"><path d="M8 4H4.8A1.8 1.8 0 0 0 3 5.8v8.4A1.8 1.8 0 0 0 4.8 16H8M12.5 6.5 16 10l-3.5 3.5M7 10h9" /></svg>
                    </span>
                    <span><strong>退出登录</strong><small>安全退出当前设备</small></span>
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
      <ConfirmDialog isOpen={showLogoutDialog} title="退出登录" message="确认退出当前账号吗？" onConfirm={async () => { setShowLogoutDialog(false); await signOut() }} onCancel={() => setShowLogoutDialog(false)} confirmText="退出" cancelText="取消" />
    </header>
  )
}

export default Header
