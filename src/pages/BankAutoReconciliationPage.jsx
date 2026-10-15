import React, { useState } from 'react'
import BankCustomerMatchDock from '@/components/bank/BankCustomerMatchDock.jsx'
import RdPrepaymentWorkbenchDock from '@/components/bank/RdPrepaymentWorkbenchDock.jsx'
import BankCenterPageV2 from './BankCenterPageV2.jsx'

export default function BankAutoReconciliationPage() {
  const [revision, setRevision] = useState(0)
  const refresh = () => setRevision((value) => value + 1)
  return (
    <>
      <details className="bank-match-tools">
        <summary>客户匹配与专项处理 <span>对方户名不一致时，先确认客户关系</span></summary>
        <div className="bank-match-tools__content">
          <BankCustomerMatchDock onChanged={refresh} />
          <RdPrepaymentWorkbenchDock onChanged={refresh} />
        </div>
      </details>
      <BankCenterPageV2 key={revision} />
    </>
  )
}
