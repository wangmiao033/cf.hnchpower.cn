import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AuthProvider } from '/src/features/auth/AuthContext.jsx'
import { AppStateProvider } from '/src/app/AppStateContext.jsx'
import { updateChannelRecord, frontendChannelRecordToPayload } from '/src/lib/api/channel.ts'
import CoreChannelBillFormPage from '/src/pages/CoreChannelBillFormPage.jsx'
const noop = () => {}
window.reviewTest = { saves: [], toasts: [], navigations: [], failSave: false, failRefresh: false }
const value = {
  channelEditRecordId: 'UI-REVIEW',
  settings: { partners: [{id:'partner-test',name:'测试渠道'}] },
  recon: {
    channelRecords: [],
    onChannelUpdateRecord: async (id, record, options = {}) => {
      window.reviewTest.saves.push({id,record})
      if (window.reviewTest.failSave) throw new Error('测试保存失败')
      const saved = await updateChannelRecord(id, { ...frontendChannelRecordToPayload(record), expected_updated_at: record.updatedAt })
      return options.returnSavedRecord ? saved : true
    },
    refetchChannelFromApi: async () => {
      window.reviewTest.refreshStarted = true
      if (window.reviewTest.refreshGate) await window.reviewTest.refreshGate
      if (window.reviewTest.failRefresh) throw new Error('测试列表刷新失败')
    }
  },
  showToast: (message, tone) => window.reviewTest.toasts.push({message,tone}),
  setActiveView: view => window.reviewTest.navigations.push(view),
  setNavigationBlocker: noop, clearNavigationBlocker: noop, openBill360: noop
}
function Fixture() {
  const [mounted, setMounted] = useState(true)
  window.unmountReviewPage = () => setMounted(false)
  return <AuthProvider><AppStateProvider value={value}>{mounted ? <CoreChannelBillFormPage mode="edit" /> : <p>已离开账单</p>}</AppStateProvider></AuthProvider>
}
createRoot(document.getElementById('fixture')).render(<Fixture />)
