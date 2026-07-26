import React, { useEffect, useRef, useState } from 'react'
import NotificationCenter from '@/components/NotificationCenter.jsx'
import Settings from '@/components/Settings.jsx'
import HelpTooltip from '@/components/HelpTooltip.jsx'
import MobileMenu from '@/components/MobileMenu.jsx'
import ConfirmDialog from '@/components/ConfirmDialog.jsx'
import { getPageMeta, SIDEBAR_GROUPS } from '@/app/routes.js'
import { useAuth } from '@/features/auth/AuthContext.jsx'
import './Header.css'

function Header({ activeView, onNavigate, onSettingsChange }) {
  const { user, signOut, updateMyPassword } = useAuth()
  const pageMeta = getPageMeta(activeView)
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [showPasswordDialog, setShowPasswordDialog] = useState(false)
  const [showLogoutDialog, setShowLogoutDialog] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [submittingPassword, setSubmittingPassword] = useState(false)
  const userMenuRef = useRef(null)
  const accountLabel = user?.display_name || user?.email || '当前用户'
  const accountDetail =
    user?.email && user.email !== accountLabel ? user.email : '系统管理员'
  const accountInitial = accountLabel.trim().slice(0, 1).toUpperCase() || 'U'

  useEffect(() => {
    if (!showUserMenu) return undefined

    const handlePointerDown = (event) => {
      if (!userMenuRef.current?.contains(event.target)) {
        setShowUserMenu(false)
      }
    }
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setShowUserMenu(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [showUserMenu])

  const closePasswordDialog = () => {
    setShowPasswordDialog(false)
    setPasswordError('')
    setCurrentPassword('')
    setNewPassword('')
    setSubmittingPassword(false)
  }

  const handlePasswordConfirm = async () => {
    if (submittingPassword) return
    if (!currentPassword.trim()) {
      setPasswordError('请输入当前密码')
      return
    }
    if (!newPassword.trim() || newPassword.trim().length < 6) {
      setPasswordError('新密码至少 6 位')
      return
    }
    setPasswordError('')
    setSubmittingPassword(true)
    try {
      await updateMyPassword(currentPassword, newPassword.trim())
      closePasswordDialog()
      window.alert('密码修改成功')
    } catch (err) {
      setPasswordError(`修改失败：${String(err?.message || err)}`)
    } finally {
      setSubmittingPassword(false)
    }
  }

  return (
    <header className="app-admin-header">
      <div className="app-admin-header__toolbar">
        <div className="app-admin-header__left">
          <div className="app-admin-header__mobile">
            <MobileMenu>
              <nav className="header-mobile-sidebar">
                {SIDEBAR_GROUPS.map((group) => (
                  <div key={group.id} className="header-mobile-group">
                    <div className="header-mobile-group-label">{group.label}</div>
                    {group.items.map((item) => (
                      <button
                        key={item.view}
                        type="button"
                        className={`header-mobile-item ${item.view === activeView ? 'active' : ''}`}
                        onClick={() => onNavigate?.(item.view)}
                      >
                        {item.label}
                      </button>
                    ))}
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
          <NotificationCenter />
          <HelpTooltip />
          <Settings onSettingsChange={onSettingsChange} />
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
              <span className="app-admin-header__user-avatar" aria-hidden="true">
                {accountInitial}
              </span>
              <span className="app-admin-header__user-name">{accountLabel}</span>
              <svg
                className="app-admin-header__user-chevron"
                viewBox="0 0 16 16"
                aria-hidden="true"
              >
                <path d="m4.5 6 3.5 3.5L11.5 6" />
              </svg>
            </button>
            {showUserMenu ? (
              <div
                id="app-account-menu"
                className="app-admin-header__user-menu"
                role="menu"
                aria-label="账号操作"
              >
                <div className="app-admin-header__user-profile">
                  <span className="app-admin-header__profile-avatar" aria-hidden="true">
                    {accountInitial}
                    <i />
                  </span>
                  <span className="app-admin-header__profile-copy">
                    <small>当前登录账号</small>
                    <strong>{accountLabel}</strong>
                    <span>{accountDetail}</span>
                  </span>
                </div>
                <div className="app-admin-header__user-actions">
                  <p>账号设置</p>
                  <button
                    type="button"
                    role="menuitem"
                    className="app-admin-header__user-menu-item"
                    onClick={() => {
                      setShowUserMenu(false)
                      setShowPasswordDialog(true)
                    }}
                  >
                    <span className="app-admin-header__menu-icon" aria-hidden="true">
                      <svg viewBox="0 0 20 20">
                        <path d="M7.7 11.9a4.7 4.7 0 1 1 3.4-3.4L17 14.4V17h-2.6v-1.8h-2v-2h-2.1l-1-1" />
                      </svg>
                    </span>
                    <span>
                      <strong>修改密码</strong>
                      <small>更新当前账号的登录密码</small>
                    </span>
                    <svg className="app-admin-header__menu-arrow" viewBox="0 0 16 16" aria-hidden="true">
                      <path d="m6 3.5 4.5 4.5L6 12.5" />
                    </svg>
                  </button>
                </div>
                <div className="app-admin-header__user-danger">
                  <button
                    type="button"
                    role="menuitem"
                    className="app-admin-header__user-menu-item danger"
                    onClick={() => {
                      setShowUserMenu(false)
                      setShowLogoutDialog(true)
                    }}
                  >
                    <span className="app-admin-header__menu-icon" aria-hidden="true">
                      <svg viewBox="0 0 20 20">
                        <path d="M8 4H4.8A1.8 1.8 0 0 0 3 5.8v8.4A1.8 1.8 0 0 0 4.8 16H8M12.5 6.5 16 10l-3.5 3.5M7 10h9" />
                      </svg>
                    </span>
                    <span>
                      <strong>退出登录</strong>
                      <small>安全退出当前设备</small>
                    </span>
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
      <ConfirmDialog
        isOpen={showPasswordDialog}
        title="修改密码"
        message={
          <div className="app-admin-header__password-form">
            <label className="app-admin-header__password-label">
              <span>当前密码</span>
              <input
                className="admin-input"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
              />
            </label>
            <label className="app-admin-header__password-label">
              <span>新密码</span>
              <input
                className="admin-input"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
              />
            </label>
            {passwordError ? <div className="app-admin-header__password-error">{passwordError}</div> : null}
          </div>
        }
        onConfirm={handlePasswordConfirm}
        onCancel={closePasswordDialog}
        confirmText={submittingPassword ? '提交中...' : '确认修改'}
        cancelText="取消"
      />
      <ConfirmDialog
        isOpen={showLogoutDialog}
        title="退出登录"
        message="确认退出当前账号吗？"
        onConfirm={async () => {
          setShowLogoutDialog(false)
          await signOut()
        }}
        onCancel={() => setShowLogoutDialog(false)}
        confirmText="退出"
        cancelText="取消"
      />
    </header>
  )
}

export default Header
