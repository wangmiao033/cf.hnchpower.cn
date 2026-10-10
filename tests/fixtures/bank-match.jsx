import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import '/src/App.jsx'
import BankAutoReconciliationPage from '/src/pages/BankAutoReconciliationPage.jsx'
import { AppStateProvider } from '/src/app/AppStateContext.jsx'
import { AuthProvider } from '/src/features/auth/AuthContext.jsx'
import mainSource from '/src/main.jsx?raw'
for (const [, path] of mainSource.matchAll(/import ['"](.+\.css)['"]/g)) {
  await import(/* @vite-ignore */ '/src/' + path.replace(/^\.\//, ''))
}
function Fixture() {
  const [opened, setOpened] = useState('')
  const noop = () => {}
  const value = { recon: { records: [], channelRecords: [] }, setActiveView: noop, showToast: noop, openBill360: (type, id) => setOpened(`${type}:${id}`) }
  return <main style={{ width: '100%', boxSizing: 'border-box' }}><AuthProvider><AppStateProvider value={value}><BankAutoReconciliationPage /></AppStateProvider></AuthProvider><output data-testid="opened">{opened}</output></main>
}
createRoot(document.getElementById('fixture')).render(<Fixture />)
