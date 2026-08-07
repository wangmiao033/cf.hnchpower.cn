import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useAppState } from '@/app/AppStateContext.jsx'
import { VIEWS } from '@/app/routes.js'
import ConfirmDialog from '@/components/ConfirmDialog.jsx'
import UserAccessEditor from '@/components/users/UserAccessEditor.jsx'
import { useAuth } from '@/features/auth/AuthContext.jsx'
import {
  createAuthUser,
  getPermissionCatalog,
  listAuthUsers,
  resetAuthUserPassword,
  setAuthUserStatus
} from '@/features/auth/api.ts'
import './UserCenterV24.css'

function formatTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

function UserCenterPage() {
  const { user, can, refreshMe, signOut, updateMyPassword } = useAuth()
  const { setActiveView, showToast } = useAppState()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [feedback, setFeedback] = useState(null)
  const [showLogoutDialog, setShowLogoutDialog] = useState(false)

  const [catalog, setCatalog] = useState(null)
  const [users, setUsers] = useState([])
  const [usersLoading, setUsersLoading] = useState(false)
  const [accessUser, setAccessUser] = useState(null)
  const [createForm, setCreateForm] = useState({
    email: '',
    displayName: '',
    role: 'operator',
    password: ''
  })
  const [creating, setCreating] = useState(false)

  const canManageUsers = can('users.manage')
  const accountLabel = user?.display_name || user?.email || '当前用户'
  const roleLabel = user?.role_label || (user?.role === 'admin' ? '管理员' : '运营')
  const permissionLabels = useMemo(() => {
    const byCode = new Map((catalog?.permissions || []).map((item) => [item.code, item.label]))
    return (user?.permissions || []).map((code) => byCode.get(code) || code)
  }, [catalog, user?.permissions])

  const refreshUsers = useCallback(async () => {
    if (!canManageUsers) return
    setUsersLoading(true)
    try {
      const [catalogResponse, usersResponse] = await Promise.all([
        getPermissionCatalog(),
        listAuthUsers()
      ])
      setCatalog(catalogResponse)
      setUsers(usersResponse.items || [])
    } catch (error) {
      showToast(error instanceof Error ? error.message : '用户权限读取失败', 'error')
    } finally {
      setUsersLoading(false)
    }
  }, [canManageUsers, showToast])

  useEffect(() => {
    if (canManageUsers) void refreshUsers()
    else {
      setCatalog(null)
      setUsers([])
      setAccessUser(null)
    }
  }, [canManageUsers, refreshUsers])

  const handlePasswordSubmit = async (event) => {
    event.preventDefault()
    if (submitting) return
    const nextPassword = newPassword.trim()
    if (!currentPassword) return setFeedback({ type: 'error', text: '请输入当前密码。' })
    if (nextPassword.length < 6) return setFeedback({ type: 'error', text: '新密码至少需要 6 位。' })
    if (nextPassword === currentPassword) return setFeedback({ type: 'error', text: '新密码不能与当前密码相同。' })
    if (nextPassword !== confirmPassword.trim()) return setFeedback({ type: 'error', text: '两次输入的新密码不一致。' })

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
      setFeedback({ type: 'error', text: `修改失败：${String(error?.message || error)}` })
    } finally {
      setSubmitting(false)
    }
  }

  const handleCreateUser = async (event) => {
    event.preventDefault()
    if (creating) return
    const email = createForm.email.trim()
    const password = createForm.password.trim()
    if (!email) return showToast('请输入登录账号', 'error')
    if (password.length < 6) return showToast('初始密码至少 6 位', 'error')
    setCreating(true)
    try {
      await createAuthUser({
        email,
        displayName: createForm.displayName.trim(),
        role: createForm.role,
        password
      })
      setCreateForm({ email: '', displayName: '', role: 'operator', password: '' })
      showToast('用户创建成功', 'success')
      await refreshUsers()
    } catch (error) {
      showToast(error instanceof Error ? error.message : '用户创建失败', 'error')
    } finally {
      setCreating(false)
    }
  }

  const handleToggleStatus = async (row) => {
    const nextActive = !row.is_active
    const action = nextActive ? '启用' : '停用'
    if (!window.confirm(`确认${action}账号 ${row.display_name || row.email} 吗？`)) return
    try {
      await setAuthUserStatus(row.id, nextActive)
      showToast(`账号已${action}`, 'success')
      await refreshUsers()
    } catch (error) {
      showToast(error instanceof Error ? error.message : `${action}失败`, 'error')
    }
  }

  const handleResetPassword = async (row) => {
    const password = window.prompt(`为 ${row.display_name || row.email} 设置新密码（至少 6 位）`)
    if (password == null) return
    if (password.trim().length < 6) return showToast('新密码至少需要 6 位', 'error')
    try {
      await resetAuthUserPassword(row.id, password.trim())
      showToast('密码已重置，该账号需要重新登录', 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : '密码重置失败', 'error')
    }
  }

  return (
    <div className="user-v24-page">
      <header className="user-v24-head">
        <div>
          <span>ACCOUNT & ACCESS</span>
          <h1>用户中心</h1>
          <p>管理当前账号安全；有权限的管理员可统一维护团队角色与细粒度权限。</p>
        </div>
        <div>
          <span className="user-v24-role-badge">{roleLabel}</span>
          <button type="button" onClick={() => setActiveView(VIEWS.DASHBOARD)}>返回工作台</button>
        </div>
      </header>

      <div className="user-v24-grid">
        <section className="user-v24-card">
          <header><div><span>当前账号</span><h2>{accountLabel}</h2></div></header>
          <dl className="user-v24-profile">
            <div><dt>登录账号</dt><dd>{user?.email || '—'}</dd></div>
            <div><dt>角色</dt><dd>{roleLabel}</dd></div>
            <div><dt>最近登录</dt><dd>{formatTime(user?.last_login_at)}</dd></div>
            <div><dt>账号状态</dt><dd>{user?.is_active ? '正常使用' : '已停用'}</dd></div>
          </dl>
          <div className="user-v24-permissions">
            {(permissionLabels.length ? permissionLabels : ['基础账号权限']).map((label) => <span key={label}>{label}</span>)}
          </div>
        </section>

        <section className="user-v24-card">
          <header><div><span>登录安全</span><h2>修改当前账号密码</h2></div></header>
          <form className="user-v24-form" onSubmit={handlePasswordSubmit}>
            <label><span>当前密码</span><input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" /></label>
            <div className="user-v24-form-row">
              <label><span>新密码</span><input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" /></label>
              <label><span>确认新密码</span><input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" /></label>
            </div>
            {feedback ? <div className="user-v24-notice" role={feedback.type === 'error' ? 'alert' : 'status'}>{feedback.text}</div> : null}
            <div className="user-v24-actions">
              <button type="button" onClick={() => setShowLogoutDialog(true)}>安全退出</button>
              <button type="submit" className="primary" disabled={submitting}>{submitting ? '更新中…' : '更新密码'}</button>
            </div>
          </form>
        </section>
      </div>

      {canManageUsers ? (
        <section className="user-v24-card user-v24-admin">
          <div className="user-v24-admin-toolbar">
            <div><span>团队账号管理</span><h2>角色与权限</h2></div>
            <form className="user-v24-create" onSubmit={handleCreateUser}>
              <label><span>登录账号</span><input value={createForm.email} onChange={(event) => setCreateForm((current) => ({ ...current, email: event.target.value }))} placeholder="账号或邮箱" /></label>
              <label><span>显示名称</span><input value={createForm.displayName} onChange={(event) => setCreateForm((current) => ({ ...current, displayName: event.target.value }))} placeholder="姓名" /></label>
              <label><span>角色</span><select value={createForm.role} onChange={(event) => setCreateForm((current) => ({ ...current, role: event.target.value }))}>{(catalog?.roles || []).map((item) => <option value={item.role} key={item.role}>{item.label}</option>)}</select></label>
              <label><span>初始密码</span><input type="password" value={createForm.password} onChange={(event) => setCreateForm((current) => ({ ...current, password: event.target.value }))} placeholder="至少 6 位" /></label>
              <button type="submit" className="primary" disabled={creating}>{creating ? '创建中…' : '创建账号'}</button>
            </form>
          </div>
          <div className="user-v24-notice">角色提供默认权限；单个账号可以在“角色与权限”里设置例外允许或明确禁止。最后一个启用中的管理员无法被停用或降级。</div>
          <div className="user-v24-table-wrap">
            <table className="user-v24-table">
              <thead><tr><th>账号</th><th>角色</th><th>状态</th><th>权限</th><th>最近登录</th><th>操作</th></tr></thead>
              <tbody>
                {usersLoading ? <tr><td colSpan="6" className="user-v24-empty">正在读取用户…</td></tr> : null}
                {!usersLoading && users.length === 0 ? <tr><td colSpan="6" className="user-v24-empty">暂无用户</td></tr> : null}
                {!usersLoading && users.map((row) => (
                  <tr key={row.id}>
                    <td><strong>{row.display_name || row.email}</strong><small>{row.email}</small></td>
                    <td><span className={`user-v24-user-role ${row.role === 'admin' ? 'is-admin' : ''}`}>{row.role_label || row.role}</span></td>
                    <td><span className={`user-v24-user-status ${row.is_active ? '' : 'is-disabled'}`}>{row.is_active ? '启用' : '停用'}</span></td>
                    <td>{row.permissions?.length || 0} 项<small>{Object.keys(row.permission_overrides || {}).length} 项例外</small></td>
                    <td>{formatTime(row.last_login_at)}</td>
                    <td><div className="user-v24-user-actions">
                      <button type="button" onClick={() => setAccessUser(row)}>角色与权限</button>
                      <button type="button" onClick={() => void handleResetPassword(row)}>重置密码</button>
                      <button type="button" className={row.is_active ? 'danger' : ''} onClick={() => void handleToggleStatus(row)}>{row.is_active ? '停用' : '启用'}</button>
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <UserAccessEditor
        open={Boolean(accessUser)}
        user={accessUser}
        catalog={catalog}
        onClose={() => setAccessUser(null)}
        showToast={showToast}
        onSaved={async (updated) => {
          await refreshUsers()
          if (updated?.id === user?.id) await refreshMe()
        }}
      />

      <ConfirmDialog
        isOpen={showLogoutDialog}
        title="退出登录"
        message="确认退出当前账号吗？退出后需要重新登录。"
        onConfirm={async () => { setShowLogoutDialog(false); await signOut() }}
        onCancel={() => setShowLogoutDialog(false)}
        confirmText="退出"
        cancelText="取消"
      />
    </div>
  )
}

export default UserCenterPage
