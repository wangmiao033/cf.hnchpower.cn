import React, { useState } from 'react'
import BankAllocationDock from '@/components/bank/BankAllocationDock.jsx'
import BankCenterPage from './BankCenterPage.jsx'

export default function BankAutoReconciliationPage() {
  const [revision, setRevision] = useState(0)
  return (
    <>
      <BankCenterPage key={revision} />
      <BankAllocationDock onChanged={() => setRevision((value) => value + 1)} />
    </>
  )
}
