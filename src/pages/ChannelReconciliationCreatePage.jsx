import React from 'react'
import CoreChannelBillFormPage from './CoreChannelBillFormPage.jsx'
import './ChannelBillInputColumns.css'

// Shared input-column and bill-remarks layout is loaded for channel bill entry.
function ChannelReconciliationCreatePage() {
  return <CoreChannelBillFormPage mode="create" />
}

export default ChannelReconciliationCreatePage
