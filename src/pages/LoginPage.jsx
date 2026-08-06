import React, { useState } from 'react'
import { ApiError } from '@/lib/api/client'
import { useAuth } from '@/features/auth/AuthContext.jsx'
import './LoginPage.css'

const REMEMBER_ACCOUNT_KEY = 'duizhang:remember-account'

function normalizeAuthError(err, fallback = '操作失败') {
  if (!(err instanceof ApiError)) return fallback
  const msg = String(err.message || fallback)
  if (msg.includes('登录已锁定')) return '尝试次数过多，账号已临时锁定，请稍后再试。'
  if (msg.includes('账号或密码错误')) return '账号或密码错误，请重新输入。'
  return msg
}

function LoginPage() {
  const { signInWithPassword } = useAuth()
  const savedAccount =
    typeof window !== 'undefined' ? window.localStorage.getItem(REMEMBER_ACCOUNT_KEY) : ''
  const [account, setAccount] = useState(savedAccount || '')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [rememberAccount, setRememberAccount] = useState(Boolean(savedAccount))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const canSubmit = account.trim().length > 0 && password.trim().length >= 6

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!canSubmit || submitting) return
    setError('')
    setSubmitting(true)
    try {
      const normalizedAccount = account.trim()
      await signInWithPassword(normalizedAccount, password)
      if (rememberAccount) {
        window.localStorage.setItem(REMEMBER_ACCOUNT_KEY, normalizedAccount)
      } else {
        window.localStorage.removeItem(REMEMBER_ACCOUNT_KEY)
      }
    } catch (err) {
      setError(normalizeAuthError(err, '登录失败'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-shell">
        <section className="login-hero-panel" aria-label="系统介绍">
          <div className="login-hero-glow login-hero-glow--one" aria-hidden="true" />
          <div className="login-hero-glow login-hero-glow--two" aria-hidden="true" />
          <div className="login-brand">
            <span className="login-brand-mark" aria-hidden="true">
              <svg viewBox="0 0 32 32">
                <path d="M9 9.5h14M9 16h9M9 22.5h14" />
                <path d="m20.5 16 2.2 2.2L27 13.8" />
              </svg>
            </span>
            <span>
              <strong>CAIWU</strong>
              <small>财务协同中心</small>
            </span>
          </div>

          <div className="login-hero-main">
            <p className="login-kicker">
              <span />
              企业内部财务工作台
            </p>
            <h1 className="login-hero-title">
              让每一笔对账
              <br />
              <em>清晰、准确、可追溯</em>
            </h1>
          </div>
          <p className="login-hero-copy">
            集中管理研发对账、渠道结算、数据库流水与客户资料，让日常财务协作更简单。
          </p>

          <div className="login-hero-metrics" aria-label="系统特点">
            <div className="login-hero-metric">
              <strong>4</strong>
              <span>核心业务模块</span>
            </div>
            <div className="login-hero-metric">
              <strong>云端</strong>
              <span>数据统一保存</span>
            </div>
            <div className="login-hero-metric">
              <strong>受保护</strong>
              <span>安全会话机制</span>
            </div>
          </div>

          <p className="login-hero-footer">© 2026 财务管理系统 · 内部授权使用</p>
        </section>

        <section className="login-card" aria-label="账号登录">
          <div className="login-card-head">
            <div className="login-mode-badge">
              <span />
              安全登录
            </div>
            <h2 className="login-title">欢迎回来</h2>
            <p className="login-subtitle">请输入你的内部账号，继续进入财务工作台。</p>
          </div>

          <form onSubmit={handleSubmit} className="login-form">
            <label className="login-label">
              <span>账号</span>
              <div className="login-input-wrap">
                <span className="login-input-icon" aria-hidden="true">
                  <svg viewBox="0 0 20 20">
                    <circle cx="10" cy="7" r="3.2" />
                    <path d="M4.5 16c.6-3 2.4-4.6 5.5-4.6s4.9 1.6 5.5 4.6" />
                  </svg>
                </span>
                <input
                  className="login-input"
                  type="text"
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                  placeholder="请输入账号"
                  autoComplete="username"
                  autoFocus={!savedAccount}
                  required
                />
              </div>
            </label>

            <label className="login-label">
              <span>密码</span>
              <div className="login-input-wrap">
                <span className="login-input-icon" aria-hidden="true">
                  <svg viewBox="0 0 20 20">
                    <rect x="4.3" y="8.5" width="11.4" height="8" rx="2" />
                    <path d="M6.8 8.5V6.8a3.2 3.2 0 0 1 6.4 0v1.7M10 12v1.5" />
                  </svg>
                </span>
                <input
                  className="login-input"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="请输入密码"
                  autoComplete="current-password"
                  autoFocus={Boolean(savedAccount)}
                  required
                />
                <button
                  type="button"
                  className="login-password-toggle"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? '隐藏密码' : '显示密码'}
                >
                  {showPassword ? '隐藏' : '显示'}
                </button>
              </div>
            </label>

            <div className="login-options">
              <div className="login-session-note">
                <span className="login-session-icon" aria-hidden="true">
                  <svg viewBox="0 0 20 20">
                    <path d="M10 2.8 16 5v4.4c0 3.7-2 6.2-6 7.8-4-1.6-6-4.1-6-7.8V5l6-2.2Z" />
                    <path d="m7.6 9.8 1.5 1.5 3.4-3.5" />
                  </svg>
                </span>
                <span>
                  <strong>登录状态由安全 Cookie 保存</strong>
                  <small>会话到期后会自动返回登录页，公共电脑使用后请主动退出。</small>
                </span>
              </div>
              <label className="login-option">
                <input
                  type="checkbox"
                  checked={rememberAccount}
                  onChange={(e) => setRememberAccount(e.target.checked)}
                />
                <span>在此设备记住账号</span>
              </label>
            </div>

            {error ? (
              <div className="login-message login-message--error" role="alert">
                <span aria-hidden="true">!</span>
                {error}
              </div>
            ) : null}

            <button type="submit" className="login-submit-btn" disabled={!canSubmit || submitting}>
              {submitting ? (
                <>
                  <span className="login-submit-spinner" aria-hidden="true" />
                  正在验证账号…
                </>
              ) : (
                <>
                  进入财务工作台
                  <svg viewBox="0 0 20 20" aria-hidden="true">
                    <path d="M4 10h11M11 6l4 4-4 4" />
                  </svg>
                </>
              )}
            </button>

            <p className="login-footnote">
              <span aria-hidden="true">●</span>
              仅限授权人员访问，操作记录将被安全留存
            </p>
          </form>
        </section>
      </div>
    </div>
  )
}

export default LoginPage
