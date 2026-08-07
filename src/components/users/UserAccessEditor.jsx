import React, { useEffect, useMemo, useState } from 'react'
import { updateUserAccess } from '@/features/auth/api.ts'
import './UserAccessEditor.css'

function groupPermissions(items = []) {
  const groups = new Map()
  for (const item of items) {
    const key = item.group || '其他'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(item)
  }
  return [...groups.entries()]
}

function rolePermissions(catalog, role) {
  return new Set(catalog?.roles?.find((item) => item.role === role)?.permissions || [])
}

function resolvedState(roleDefaults, overrides, permission) {
  const override = overrides?.[permission]
  if (override === 'allow' || override === 'deny') return override
  return roleDefaults.has(permission) ? 'role-allow' : 'role-deny'
}

export default function UserAccessEditor({
  open,
  user,
  catalog,
  onClose,
  onSaved,
  showToast
}) {
  const [role, setRole] = useState('operator')
  const [overrides, setOverrides] = useState({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open || !user) return
    setRole(user.role === 'user' ? 'operator' : user.role || 'operator')
    setOverrides(user.permission_overrides || {})
  }, [open, user])

  const grouped = useMemo(() => groupPermissions(catalog?.permissions || []), [catalog])
  const defaults = useMemo(() => rolePermissions(catalog, role), [catalog, role])
  const isAdmin = role === 'admin'

  const setOverride = (permission, state) => {
    setOverrides((current) => {
      const next = { ...current }
      if (state === 'inherit') delete next[permission]
      else next[permission] = state
      return next
    })
  }

  const save = async () => {
    if (!user?.id) return
    setSaving(true)
    try {
      const updated = await updateUserAccess(user.id, {
        role,
        permission_overrides: isAdmin ? {} : overrides
      })
      showToast?.(`已更新 ${updated.display_name || updated.email} 的角色与权限`, 'success')
      await onSaved?.(updated)
      onClose?.()
    } catch (error) {
      showToast?.(error instanceof Error ? error.message : '权限保存失败', 'error')
    } finally {
      setSaving(false)
    }
  }

  if (!open || !user) return null

  return (
    <div className="user-access-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !saving) onClose?.()
    }}>
      <section className="user-access-editor" role="dialog" aria-modal="true" aria-label="用户角色与权限">
        <header>
          <div>
            <span>角色与权限</span>
            <h2>{user.display_name || user.email}</h2>
            <p>{user.email}</p>
          </div>
          <button type="button" onClick={onClose} disabled={saving} aria-label="关闭">×</button>
        </header>

        <div className="user-access-role">
          <label>
            <span>角色预设</span>
            <select value={role} onChange={(event) => {
              setRole(event.target.value)
              setOverrides({})
            }} disabled={saving}>
              {(catalog?.roles || []).map((item) => (
                <option value={item.role} key={item.role}>{item.label}</option>
              ))}
            </select>
          </label>
          <div>
            {role === 'admin' ? (
              <strong>管理员始终拥有全部权限，用户级禁止项不会覆盖管理员。</strong>
            ) : (
              <span>默认权限来自角色；只有例外项才需要设置“额外允许”或“明确禁止”。</span>
            )}
          </div>
        </div>

        <div className="user-access-matrix">
          {grouped.map(([group, permissions]) => (
            <section key={group}>
              <h3>{group}</h3>
              <div>
                {permissions.map((permission) => {
                  const state = isAdmin
                    ? 'role-allow'
                    : resolvedState(defaults, overrides, permission.code)
                  const inheritedAllow = defaults.has(permission.code)
                  return (
                    <article key={permission.code}>
                      <div className="user-access-permission-copy">
                        <strong>{permission.label}</strong>
                        <span>{permission.description}</span>
                        <code>{permission.code}</code>
                      </div>
                      <div className="user-access-permission-state">
                        <span className={`resolved is-${state.includes('allow') ? 'allow' : 'deny'}`}>
                          {state.includes('allow') ? '最终允许' : '最终禁止'}
                        </span>
                        {isAdmin ? (
                          <span className="admin-fixed">管理员固定</span>
                        ) : (
                          <select
                            value={overrides[permission.code] || 'inherit'}
                            onChange={(event) => setOverride(permission.code, event.target.value)}
                            disabled={saving}
                            title={`角色默认：${inheritedAllow ? '允许' : '禁止'}`}
                          >
                            <option value="inherit">跟随角色（{inheritedAllow ? '允许' : '禁止'}）</option>
                            <option value="allow">额外允许</option>
                            <option value="deny">明确禁止</option>
                          </select>
                        )}
                      </div>
                    </article>
                  )
                })}
              </div>
            </section>
          ))}
        </div>

        <footer>
          <div>
            <span>当前角色：{catalog?.roles?.find((item) => item.role === role)?.label || role}</span>
            {!isAdmin ? <span>例外权限：{Object.keys(overrides).length} 项</span> : null}
          </div>
          <div>
            <button type="button" onClick={onClose} disabled={saving}>取消</button>
            <button type="button" className="primary" onClick={save} disabled={saving}>
              {saving ? '保存中…' : '保存权限'}
            </button>
          </div>
        </footer>
      </section>
    </div>
  )
}
