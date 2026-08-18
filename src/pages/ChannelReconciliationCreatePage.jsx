import React from 'react'
import CoreChannelBillFormPage from './CoreChannelBillFormPage.jsx'
import './ChannelBillInputColumns.css'

// Display density is handled by the shared core channel bill page.
function ChannelReconciliationCreatePage() {
  return <CoreChannelBillFormPage mode="create" />
}

export default ChannelReconciliationCreatePage
