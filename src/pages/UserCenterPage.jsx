import React, { useState } from 'react'
import { useAppState } from '@/app/AppStateContext.jsx'
import { VIEWS } from '@/app/routes.js'
import ConfirmDialog from '@/components/ConfirmDialog.jsx'
import PageContainer from '@/components/layout/PageContainer.jsx'
import { useAuth } from '@/features/auth/AuthContext.jsx'
import './UserCenterPage.css'

function formatLoginTime(value) {
  if (!value) return '本次登录'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '本次登录'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

function UserCenterPage() {
  const { user, signOut, updateMyPassword } = useAuth()
  const { setActiveView, showToast } = useAppState()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPasswords, setShowPasswords] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [feedback, setFeedback] = useState(null)
  const [showLogoutDialog, setShowLogoutDialog] = useState(false)

  const accountLabel = user?.display_name || user?.email || '当前用户'
  const accountId = user?.email || user?.display_name || '—'
  const accountInitial = accountLabel.trim().slice(0, 1).toUpperCase() || 'U'
  const roleLabel = user?.role === 'admin' ? '系统管理员' : '普通用户'
  const passwordType = showPasswords ? 'text' : 'password'

  const handlePasswordSubmit = async (event) => {
    event.preventDefault()
    if (submitting) return

    const nextPassword = newPassword.trim()
    if (!currentPassword) {
      setFeedback({ type: 'error', text: '请输入当前密码。' })
      return
    }
    if (nextPassword.length < 6) {
      setFeedback({ type: 'error', text: '新密码至少需要 6 位。' })
      return
    }
    if (nextPassword === currentPassword) {
      setFeedback({ type: 'error', text: '新密码不能与当前密码相同。' })
      return
    }
    if (nextPassword !== confirmPassword.trim()) {
      setFeedback({ type: 'error', text: '两次输入的新密码不一致。' })
      return
    }

    setSubmitting(true)
    setFeedback(null)
    try {
      await updateMyPassword(currentPassword, nextPassword)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setFeedback({ type: 'success', text: '密码已更新，下次登录请使用新密码。' })
      showToast('密码修改成功', 'success')
    } catch (error) {
      setFeedback({
        type: 'error',
        text: `修改失败：${String(error?.message || error)}`
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <PageContainer hideHeader className="user-center-page">
      <section className="user-center-hero">
        <div className="user-center-identity">
          <span className="user-center-avatar" aria-hidden="true">
            {accountInitial}
            <i />
          </span>
          <div>
            <p>当前登录账号</p>
            <h1>{accountLabel}</h1>
            <span>{roleLabel} · 账号状态正常</span>
          </div>
        </div>
        <button
          type="button"
          className="user-center-back"
          onClick={() => setActiveView(VIEWS.DASHBOARD)}
        >
          返回工作台
        </button>
      </section>

      <div className="user-center-layout">
        <div className="user-center-side">
          <section className="user-center-card" aria-labelledby="account-overview-title">
            <div className="user-center-card__heading">
              <span className="user-center-card__icon user-center-card__icon--blue" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <circle cx="12" cy="8" r="4" />
                  <path d="M4.5 20c1-4 3.5-6 7.5-6s6.5 2 7.5 6" />
                </svg>
              </span>
              <div>
                <h2 id="account-overview-title">账号信息</h2>
                <p>当前账号的身份与权限</p>
              </div>
            </div>
            <dl className="user-center-details">
              <div>
                <dt>登录账号</dt>
                <dd>{accountId}</dd>
              </div>
              <div>
                <dt>账号角色</dt>
                <dd>{roleLabel}</dd>
              </div>
              <div>
                <dt>账号状态</dt>
                <dd><span className="user-center-status">正常使用</span></dd>
              </div>
            </dl>
          </section>

          <section className="user-center-card" aria-labelledby="session-title">
            <div className="user-center-card__heading">
              <span className="user-center-card__icon user-center-card__icon--green" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <rect x="4" y="5" width="16" height="12" rx="2" />
                  <path d="M9 21h6M12 17v4" />
                </svg>
              </span>
              <div>
                <h2 id="session-title">当前会话</h2>
                <p>登录状态由服务器安全保存</p>
              </div>
            </div>
            <div className="user-center-session">
              <span className="user-center-session__dot" aria-hidden="true" />
              <div>
                <strong>当前设备在线</strong>
                <span>最近登录：{formatLoginTime(user?.last_login_at)}</span>
                <small>换电脑后使用同一账号登录，业务数据仍会保留。</small>
              </div>
            </div>
          </section>

          <section className="user-center-card user-center-card--danger" aria-labelledby="logout-title">
            <div>
              <h2 id="logout-title">退出当前设备</h2>
              <p>退出后需要重新输入账号和密码。</p>
            </div>
            <button type="button" onClick={() => setShowLogoutDialog(true)}>
              安全退出
            </button>
          </section>
        </div>

        <section className="user-center-card user-center-security" aria-labelledby="security-title">
          <div className="user-center-card__heading user-center-security__heading">
            <span className="user-center-card__icon user-center-card__icon--violet" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <rect x="4" y="10" width="16" height="10" rx="2" />
                <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v2" />
              </svg>
            </span>
            <div>
              <h2 id="security-title">登录安全</h2>
              <p>定期更新密码可以降低账号风险</p>
            </div>
            <span className="user-center-security__badge">密码保护已启用</span>
          </div>

          <form className="user-center-password-form" onSubmit={handlePasswordSubmit} noValidate>
            <div className="user-center-field">
              <label htmlFor="user-current-password">当前密码</label>
              <div className="user-center-input-wrap">
                <input
                  id="user-current-password"
                  type={passwordType}
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  autoComplete="current-password"
                  placeholder="请输入当前登录密码"
                />
                <button
                  type="button"
                  onClick={() => setShowPasswords((value) => !value)}
                  aria-label={showPasswords ? '隐藏密码' : '显示密码'}
                >
                  {showPasswords ? '隐藏' : '显示'}
                </button>
              </div>
            </div>

            <div className="user-center-field">
              <label htmlFor="user-new-password">新密码</label>
              <div className="user-center-input-wrap">
                <input
                  id="user-new-password"
                  type={passwordType}
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  autoComplete="new-password"
                  placeholder="至少 6 位，建议包含字母和数字"
                />
              </div>
            </div>

            <div className="user-center-field">
              <label htmlFor="user-confirm-password">确认新密码</label>
              <div className="user-center-input-wrap">
                <input
                  id="user-confirm-password"
                  type={passwordType}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  autoComplete="new-password"
                  placeholder="请再次输入新密码"
                />
              </div>
            </div>

            <div className="user-center-password-tips">
              <strong>安全建议</strong>
              <ul>
                <li>不要使用姓名、手机号等容易猜测的信息</li>
                <li>不要与其他网站共用同一个密码</li>
                <li>修改成功后，下次登录需要使用新密码</li>
              </ul>
            </div>

            {feedback ? (
              <div
                className={`user-center-feedback user-center-feedback--${feedback.type}`}
                role={feedback.type === 'error' ? 'alert' : 'status'}
                aria-live="polite"
              >
                {feedback.text}
              </div>
            ) : null}

            <div className="user-center-form-actions">
              <button
                type="button"
                className="user-center-clear"
                onClick={() => {
                  setCurrentPassword('')
                  setNewPassword('')
                  setConfirmPassword('')
                  setFeedback(null)
                }}
                disabled={submitting}
              >
                清空
              </button>
              <button type="submit" className="user-center-submit" disabled={submitting}>
                {submitting ? '正在更新...' : '更新密码'}
              </button>
            </div>
          </form>
        </section>
      </div>

      <ConfirmDialog
        isOpen={showLogoutDialog}
        title="退出登录"
        message="确认退出当前账号吗？退出后需要重新登录。"
        onConfirm={async () => {
          setShowLogoutDialog(false)
          await signOut()
        }}
        onCancel={() => setShowLogoutDialog(false)}
        confirmText="退出"
        cancelText="取消"
      />
    </PageContainer>
  )
}

export default UserCenterPage
