import React from 'react'
import './ErrorBoundary.css'

const CHUNK_ERROR_PATTERN =
  /ChunkLoadError|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i
const CHUNK_RECOVERY_KEY = 'cf-chunk-recovery'

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    console.error('错误捕获:', error, errorInfo)
    const message = `${error?.name || ''} ${error?.message || ''}`
    if (!CHUNK_ERROR_PATTERN.test(message)) return

    const pageKey = `${window.location.pathname}${window.location.search}`
    if (window.sessionStorage.getItem(CHUNK_RECOVERY_KEY) === pageKey) return
    window.sessionStorage.setItem(CHUNK_RECOVERY_KEY, pageKey)
    window.location.reload()
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
  }

  handleReload = () => {
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
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

