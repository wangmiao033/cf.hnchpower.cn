import React from 'react'
import ReactDOM from 'react-dom/client'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { ThemeProvider } from './contexts/ThemeContext.jsx'
import { AuthProvider } from '@/features/auth/AuthContext.jsx'
import './index.css'
import './styles/V4SystemPolish.css'
import './styles/SystemDetailPolishV42.css'
import './styles/RdLedgerWidthFix.css'
import './styles/RdLedgerActionPolish.css'
import './styles/RdLedgerDeleteAction.css'
import './styles/ChannelLedgerV2.css'
import './styles/ChannelLedgerV3.css'
import './styles/ChannelLedgerV4.css'

// Keep the page-specific channel-ledger visual polish last in the global style cascade.
const PRELOAD_RECOVERY_KEY = 'cf-preload-recovery'

window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
  const pageKey = `${window.location.pathname}${window.location.search}`
  if (window.sessionStorage.getItem(PRELOAD_RECOVERY_KEY) === pageKey) return
  window.sessionStorage.setItem(PRELOAD_RECOVERY_KEY, pageKey)
  window.location.reload()
})

window.setTimeout(() => {
  window.sessionStorage.removeItem(PRELOAD_RECOVERY_KEY)
}, 5000)

dayjs.locale('zh-cn')

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </React.StrictMode>,
)
