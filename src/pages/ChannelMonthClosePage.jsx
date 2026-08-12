import React from 'react'
import { useAppState } from '@/app/AppStateContext.jsx'
import { useAuth } from '@/features/auth/AuthContext.jsx'
import ChannelMonthCloseLauncher from '@/components/channel/ChannelMonthCloseLauncher.jsx'

export default function ChannelMonthClosePage() {
  const {
    recon,
    settings,
    showToast,
    setActiveView,
    openChannelReconciliationEdit,
    openBill360
  } = useAppState()
  const { can } = useAuth()

  if (!can('contracts.view')) {
    return (
      <div style={{ padding: '18px 20px' }}>
        <section style={{ padding: '24px', border: '1px solid #e2e8f0', borderRadius: 12, background: '#fff' }}>
          <strong style={{ display: 'block', color: '#334155', marginBottom: 6 }}>月结管理需要合同查看权限</strong>
          <span style={{ color: '#64748b', fontSize: 13 }}>月结矩阵以合同合作清单作为“本月应有账单”的判断依据。</span>
        </section>
      </div>
    )
  }

  return (
    <div style={{ padding: '16px 20px 20px' }}>
      <ChannelMonthCloseLauncher
        channelRecords={recon.channelRecords || []}
        partners={settings?.partners || []}
        onNavigate={setActiveView}
        onOpenEdit={(billId) => openChannelReconciliationEdit?.(billId, 'recon-month-close')}
        onOpenView={(billId) => openBill360?.('channel', billId)}
        onNotice={(message, tone = 'info') => showToast(message, tone)}
      />
    </div>
  )
}
