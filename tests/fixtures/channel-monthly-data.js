// Synthetic reproduction of the reported July totals; no production records.
export function monthlyBills() {
  const bill = (id, channelName, amount, items, extra = {}) => ({
    id, channelName, partnerName: `${channelName}测试合作方`, statementNo: `TEST-${id}`,
    status: 'confirmed', settlementMonth: '2026-07', settlementAmount: amount,
    receivedAmount: 0, items: items || [{ settlementCycle: '2026-07', gameName: '测试游戏', settlementAmount: amount }],
    ...extra
  })
  return [
    ...Array.from({ length: 37 }, (_, i) => bill(`ordinary-${i}`, '普通测试渠道', 1000)),
    bill('cross-a', '跨月甲', 10508.91, [
      { settlementCycle: '2026-07', gameName: '测试游戏', settlementAmount: 10000 },
      { settlementCycle: '2026-08', gameName: '测试游戏', settlementAmount: 508.91 }
    ], { receivedAmount: 1000 }),
    bill('cross-b', '跨月乙', 4446.50, [
      { settlementCycle: '2026-06', gameName: '测试游戏', settlementAmount: 372.92 },
      { settlementCycle: '2026-07', gameName: '测试游戏', settlementAmount: 4073.58 }
    ]),
    ...Array.from({ length: 6 }, (_, i) => bill(`archive-${i}`, '归档测试渠道', i === 5 ? 4876.51 : 1000))
  ]
}

export function toApiBill(row) {
  return {
    id: row.id, channel_name: row.channelName, partner_name: row.partnerName,
    statement_no: row.statementNo, status: row.status, settlement_month: row.settlementMonth,
    settlement_amount: row.settlementAmount, received_amount: row.receivedAmount,
    items: row.items.map((line, i) => ({ id: `${row.id}-${i}`, game_name: line.gameName,
      settlement_cycle: line.settlementCycle, settlement_amount: line.settlementAmount }))
  }
}
