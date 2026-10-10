import React, { useState } from 'react'
import BankCustomerMatchDock from '@/components/bank/BankCustomerMatchDock.jsx'
import RdPrepaymentWorkbenchDock from '@/components/bank/RdPrepaymentWorkbenchDock.jsx'
import BankCenterPageV2 from './BankCenterPageV2.jsx'

export default function BankAutoReconciliationPage() {
  const [revision, setRevision] = useState(0)
  const refresh = () => setRevision((value) => value + 1)
  return (
    <>
      <div className="bank-match-tools">
        <RdPrepaymentWorkbenchDock onChanged={refresh} />
        <BankCustomerMatchDock onChanged={refresh} />
      </div>
      <BankCenterPageV2 key={revision} />
    </>
  )
}
