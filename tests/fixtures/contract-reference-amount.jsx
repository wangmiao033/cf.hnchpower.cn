
import React from 'react'
import { createRoot } from 'react-dom/client'
import Panel from '/src/components/reconciliation/ContractDifferenceActionPanel.jsx'
const item = { id: 'case-reference', line_id: 'line-reference', status: 'pending',
  game_name: '测试游戏', settlement_cycle: '2026-08', expected_amount: 376, actual_amount: 21.55,
  variance_abs: 354.45, variance_direction: 'under', source_snapshot: {
    contract_amount: { status: 'manual', deterministic: false, expected_amount: 376, actual_amount: 21.55 },
    checks: [{ key: 'channel_fee_rate', label: '渠道费率', status: 'fail', bill_value: 0, contract_value: 5 }]
  } }
createRoot(document.getElementById('root')).render(React.createElement(Panel,
  { billType: 'channel', billId: 'fixture-only', initialItems: [item] }))
