import React from 'react'
import './ErrorBoundary.css'

const CHUNK_ERROR_PATTERN =
  /ChunkLoadError|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i
const CHUNK_RECOVERY_KEY = 'cf-chunk-recovery'

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null, recoveringChunk: false }
  }

  static getDerivedStateFromError(error) {
    const message = `${error?.name || ''} ${error?.message || ''}`
    return { hasError: true, error, recoveringChunk: CHUNK_ERROR_PATTERN.test(message) }
  }

  componentDidCatch(error, errorInfo) {
    console.error('错误捕获:', error, errorInfo)
    const message = `${error?.name || ''} ${error?.message || ''}`
    if (!CHUNK_ERROR_PATTERN.test(message)) return

    const pageKey = `${window.location.pathname}${window.location.search}`
    try {
      if (window.sessionStorage.getItem(CHUNK_RECOVERY_KEY) === pageKey) {
        this.setState({ recoveringChunk: false })
        return
      }
      window.sessionStorage.setItem(CHUNK_RECOVERY_KEY, pageKey)
    } catch {
      // Storage restrictions must not cause an infinite auto-reload loop.
      this.setState({ recoveringChunk: false })
      return
    }
    window.location.reload()
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, recoveringChunk: false })
  }

  handleReload = () => {
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      if (this.state.recoveringChunk) {
        return (
          <div className="error-boundary error-boundary--recovering" role="status">
            <div className="error-content">
              <span className="error-boundary__spinner" aria-hidden="true" />
              <h2>正在恢复页面资源…</h2>
              <p>浏览器缓存与新版页面不一致，正在自动恢复。</p>
              <button type="button" className="reload-btn" onClick={this.handleReload}>手动刷新</button>
            </div>
          </div>
        )
      }
      return (
        <div className="error-boundary">
          <div className="error-content">
            <div className="error-icon">⚠️</div>
            <h2>出现错误</h2>
            <p>应用程序遇到了一个错误。这可能是暂时的，请尝试刷新页面。</p>
            {this.state.error && (
              <details className="error-details">
                <summary>错误详情</summary>
                <pre>{this.state.error.toString()}</pre>
              </details>
            )}
            <div className="error-actions">
              <button className="retry-btn" onClick={this.handleReset}>
                重试
              </button>
              <button className="reload-btn" onClick={this.handleReload}>
                刷新页面
              </button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

export default ErrorBoundary

