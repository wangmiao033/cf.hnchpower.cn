import React, { useMemo, useState } from 'react'

function numberValue(value) {
  const parsed = Number.parseFloat(String(value ?? '').replace(/[￥¥,\s]/g, ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function money(value) {
  return `¥ ${numberValue(value).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`
}

function percent(value) {
  return `${numberValue(value).toFixed(1)}%`
}

function matchedBill(row) {
  return numberValue(row.matchedBill ?? row.backendBill)
}

function unmatchedAmount(row) {
  if (row.unmatchedAmount != null) return numberValue(row.unmatchedAmount)
  return Math.abs(numberValue(row.sourceFlow) - matchedBill(row))
}

function normalizeMonth(value) {
  const raw = String(value || '').trim()
  const match = raw.match(/^(\d{4})(?:-|年)\s*(\d{1,2})/)
  return match ? `${match[1]}-${String(Number(match[2])).padStart(2, '0')}` : raw
}

function monthLabel(value) {
  const match = normalizeMonth(value).match(/^(\d{4})-(\d{2})$/)
  return match ? `${match[1]}年${Number(match[2])}月` : value || '当前账期'
}

function textScore(source, candidate) {
  const left = String(source || '').trim().toLowerCase()
  const right = String(candidate || '').trim().toLowerCase()
  if (!left || !right) return 0
  if (left === right) return 3
  if (left.includes(right) || right.includes(left)) return 2
  return 0
}

function buildCandidates(records, sourceRow, month) {
  const candidates = []
  for (const record of records || []) {
    const items = Array.isArray(record.items) && record.items.length > 0 ? record.items : [null]
    items.forEach((item, itemIndex) => {
      const amount = numberValue(
        item
          ? item.flow ?? item.billingFlow ?? item.revenue ?? item.gameFlow
          : record.flow ?? record.billingFlow ?? record.gameFlow
      )
      const recordMonth = normalizeMonth(
        item?.settlementMonth || record.settlementMonth || record.month
      )
      const gameName = item?.gameName || item?.productName || record.gameName || record.product || '-'
      const channelName =
        item?.channelName || record.channelName || record.partnerName || record.channel || '-'
      const billNumber =
        record.billNumber || record.statementNo || record.settlementNumber || `渠道账单 ${record.id}`
      const monthMatch = recordMonth && recordMonth === normalizeMonth(month)
      const channelMatch = textScore(sourceRow.channel, channelName)
      const productMatch = textScore(sourceRow.product, gameName)
      const difference = amount - numberValue(sourceRow.sourceFlow)

      candidates.push({
        candidateId: `${record.id}:${item?.id || gameName || 'record'}:${itemIndex}`,
        recordId: record.id,
        billNumber,
        month: recordMonth,
        channelName,
        gameName,
        amount,
        difference,
        monthMatch,
        channelMatch,
        productMatch,
        score: (monthMatch ? 100 : 0) + channelMatch * 20 + productMatch * 15
      })
    })
  }

  return candidates.sort(
    (a, b) =>
      b.score - a.score ||
      Math.abs(a.difference) - Math.abs(b.difference) ||
      String(a.billNumber).localeCompare(String(b.billNumber), 'zh-CN')
  )
}

function ProgressBar({ value, tone = 'blue' }) {
  const width = Math.max(0, Math.min(100, numberValue(value)))
  return (
    <div
      className={`channel-progress-bar channel-progress-bar--${tone}`}
      role="progressbar"
      aria-valuemin="0"
      aria-valuemax="100"
      aria-valuenow={Math.round(width)}
    >
      <span style={{ width: `${width}%` }} />
    </div>
  )
}

function MatchDialog({
  sourceRow,
  month,
  records,
  onClose,
  onConfirm,
  onEditBill,
  onCreateBill
}) {
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState(sourceRow.matchedCandidateId || '')
  const [scope, setScope] = useState('period')
  const candidates = useMemo(
    () => buildCandidates(records, sourceRow, month),
    [month, records, sourceRow]
  )
  const periodCandidates = useMemo(
    () => candidates.filter((candidate) => candidate.monthMatch),
    [candidates]
  )
  const historyCandidates = useMemo(
    () => candidates.filter((candidate) => !candidate.monthMatch),
    [candidates]
  )
  const visibleCandidates = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    const scopedCandidates = scope === 'history' ? historyCandidates : periodCandidates
    if (!keyword) return scopedCandidates
    return scopedCandidates.filter((candidate) =>
      [
        candidate.billNumber,
        candidate.channelName,
        candidate.gameName,
        candidate.month
      ]
        .join(' ')
        .toLowerCase()
        .includes(keyword)
    )
  }, [historyCandidates, periodCandidates, query, scope])
  const selected = candidates.find((candidate) => candidate.candidateId === selectedId)
  const exact = selected && Math.abs(selected.difference) <= 0.01
  const canConfirm = selected?.monthMatch

  return (
    <div className="channel-match-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="channel-match-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="channel-match-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="channel-match-head">
          <div>
            <span>渠道流水核对</span>
            <h2 id="channel-match-title">选择对应的渠道账单</h2>
            <p>选中账单后核对金额，一致即可完成；有差异时会保留在待处理列表。</p>
          </div>
          <button type="button" aria-label="关闭" onClick={onClose}>×</button>
        </header>

        <div className="channel-match-source">
          <div><span>账期</span><strong>{monthLabel(month)}</strong></div>
          <div><span>产品</span><strong title={sourceRow.product}>{sourceRow.product}</strong></div>
          <div><span>渠道</span><strong title={sourceRow.channel}>{sourceRow.channel}</strong></div>
          <div><span>源流水</span><strong>{money(sourceRow.sourceFlow)}</strong></div>
        </div>

        <div className="channel-match-toolbar">
          <div className="channel-match-scope" aria-label="候选账单范围">
            <button
              type="button"
              className={scope === 'period' ? 'is-active' : ''}
              onClick={() => {
                setScope('period')
                setSelectedId('')
              }}
            >
              本月候选 {periodCandidates.length}
            </button>
            <button
              type="button"
              className={scope === 'history' ? 'is-active' : ''}
              onClick={() => {
                setScope('history')
                setSelectedId('')
              }}
            >
              历史账单 {historyCandidates.length}
            </button>
          </div>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索账单编号、渠道或产品"
            autoFocus
          />
          <span>共 {visibleCandidates.length} 个候选</span>
        </div>

        <div className="channel-match-list">
          {visibleCandidates.length === 0 ? (
            <div className="channel-match-empty">
              <strong>
                {scope === 'period'
                  ? `${monthLabel(month)}没有可核对的渠道账单`
                  : '没有找到符合条件的历史账单'}
              </strong>
              <span>
                {scope === 'period'
                  ? '请先新增该账期渠道账单；历史账单不会自动用于本月核对。'
                  : '可以调整搜索条件，或返回查看本月候选账单。'}
              </span>
              <div className="channel-match-empty-actions">
                {scope === 'period' && (
                  <button type="button" onClick={() => onCreateBill(sourceRow)}>
                    新增渠道账单
                  </button>
                )}
                <button
                  type="button"
                  className="is-secondary"
                  onClick={() => {
                    setScope(scope === 'period' ? 'history' : 'period')
                    setSelectedId('')
                    setQuery('')
                  }}
                >
                  {scope === 'period' ? '查看历史账单' : '返回本月候选'}
                </button>
              </div>
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th aria-label="选择" />
                  <th>编号</th>
                  <th>账期</th>
                  <th>渠道</th>
                  <th>产品</th>
                  <th>账单流水</th>
                  <th>差额</th>
                </tr>
              </thead>
              <tbody>
                {visibleCandidates.map((candidate) => {
                  const isSelected = candidate.candidateId === selectedId
                  const isExact = Math.abs(candidate.difference) <= 0.01
                  return (
                    <tr
                      key={candidate.candidateId}
                      className={isSelected ? 'is-selected' : ''}
                      onClick={() => setSelectedId(candidate.candidateId)}
                    >
                      <td>
                        <input
                          type="radio"
                          name="channel-match-candidate"
                          checked={isSelected}
                          onChange={() => setSelectedId(candidate.candidateId)}
                          aria-label={`选择 ${candidate.billNumber}`}
                        />
                      </td>
                      <td><strong>{candidate.billNumber}</strong></td>
                      <td>{monthLabel(candidate.month)}</td>
                      <td title={candidate.channelName}>{candidate.channelName}</td>
                      <td title={candidate.gameName}>{candidate.gameName}</td>
                      <td className="is-number">{money(candidate.amount)}</td>
                      <td className={`is-number ${isExact ? 'is-exact' : 'is-difference'}`}>
                        {isExact ? '金额一致' : money(Math.abs(candidate.difference))}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {selected && (
          <div className={`channel-match-result ${exact ? 'is-exact' : 'has-difference'}`}>
            <div><span>源流水</span><strong>{money(sourceRow.sourceFlow)}</strong></div>
            <div><span>账单流水</span><strong>{money(selected.amount)}</strong></div>
            <div>
              <span>核对结果</span>
              <strong>
                {!selected.monthMatch
                  ? '跨月账单仅供追溯，请先修正账期'
                  : exact
                    ? '金额一致，可完成核对'
                    : `仍差 ${money(Math.abs(selected.difference))}`}
              </strong>
            </div>
          </div>
        )}

        <footer className="channel-match-footer">
          <button type="button" className="is-secondary" onClick={onClose}>取消</button>
          <button
            type="button"
            className="is-secondary"
            disabled={!selected}
            onClick={() => selected && onEditBill(selected.recordId)}
          >
            编辑所选账单
          </button>
          <button
            type="button"
            className="is-primary"
            disabled={!canConfirm}
            title={selected && !selected.monthMatch ? '历史账单不能直接核对本月流水' : ''}
            onClick={() => selected && onConfirm(sourceRow, selected)}
          >
            {!selected?.monthMatch
              ? '请先修正账期'
              : exact
                ? '确认完成核对'
                : '确认关联并保留差异'}
          </button>
        </footer>
      </div>
    </div>
  )
}

function ChannelReconciliationProgressPanel({
  snapshot,
  expanded,
  onToggle,
  onImport,
  channelRecords = [],
  onConfirmMatch,
  onEditBill,
  onCreateBill
}) {
  const [activeRow, setActiveRow] = useState(null)
  const totals = snapshot.totals

  const handleConfirm = (row, candidate) => {
    onConfirmMatch?.(row, candidate)
    setActiveRow(null)
  }

  return (
    <section className="channel-progress-panel">
      <div className="channel-progress-head">
        <div>
          <div className="channel-progress-heading-line">
            <span className="channel-progress-period">{monthLabel(snapshot.month)}</span>
            <h2>渠道对账进度</h2>
            <span className="channel-progress-local-state">实时核对</span>
          </div>
          <p>{snapshot.fileName} · 源流水与渠道账单逐条核对</p>
        </div>
        <div className="channel-progress-actions">
          <button type="button" onClick={onImport}>更新进度数据</button>
          {onToggle && (
            <button type="button" className="channel-progress-toggle" onClick={onToggle}>
              {expanded ? '收起' : '展开'}
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="channel-progress-body">
          <div className="channel-progress-overview">
            <div className="channel-progress-primary">
              <span>流水已核对</span>
              <strong>{percent(totals.reconciliationAmountPercent)}</strong>
              <ProgressBar value={totals.reconciliationAmountPercent} />
              <p>{money(totals.reconciledFlow)}<span> / {money(totals.sourceFlow)}</span></p>
            </div>
            <div className="channel-progress-stages">
              <div><span>源流水</span><strong>{totals.rows} 条</strong><small>{money(totals.sourceFlow)}</small></div>
              <div className="is-complete"><span>已核对</span><strong>{totals.reconciledRows} 条</strong><small>{money(totals.reconciledFlow)}</small></div>
              <div className="is-receivable"><span>已登记应收</span><strong>{totals.receivableRows} 条</strong><small>{money(totals.receivableFlow)}</small></div>
              <div className="is-warning"><span>待处理</span><strong>{totals.unresolvedRows} 条</strong><small>{money(totals.unresolvedFlow)}</small></div>
            </div>
          </div>

          <div className="channel-progress-secondary">
            <div><div><span>金额覆盖率</span><strong>{percent(totals.reconciliationAmountPercent)}</strong></div><ProgressBar value={totals.reconciliationAmountPercent} tone="green" /></div>
            <div><div><span>明细完成率</span><strong>{percent(totals.reconciliationRowPercent)}</strong></div><ProgressBar value={totals.reconciliationRowPercent} tone="slate" /></div>
            <div><div><span>应收登记率</span><strong>{percent(totals.receivableAmountPercent)}</strong></div><ProgressBar value={totals.receivableAmountPercent} tone="violet" /></div>
          </div>

          <div className="channel-progress-issues">
            <div className="channel-progress-issues-head">
              <div><h3>待核对流水</h3><span>选择后台渠道账单并确认金额</span></div>
              <strong>{money(totals.unresolvedFlow)}</strong>
            </div>
            <div className="channel-progress-table-wrap">
              <table className="channel-progress-table">
                <thead>
                  <tr>
                    <th>产品</th>
                    <th>渠道</th>
                    <th>源流水</th>
                    <th>已匹配账单</th>
                    <th>未匹配金额</th>
                    <th>状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.unresolved.length === 0 ? (
                    <tr><td colSpan={7} className="channel-progress-empty">当前账期流水已全部核对</td></tr>
                  ) : (
                    snapshot.unresolved.map((row) => (
                      <tr key={row.id || `${row.product}-${row.channel}`}>
                        <td><strong>{row.product}</strong></td>
                        <td>{row.channel}</td>
                        <td className="is-number">{money(row.sourceFlow)}</td>
                        <td className="is-number">{money(matchedBill(row))}</td>
                        <td className="is-number is-difference">{money(unmatchedAmount(row))}</td>
                        <td>
                          <span className={`channel-progress-pending ${row.matchStatus === 'difference' ? 'has-difference' : ''}`}>
                            {row.matchStatus === 'difference' ? '有差异' : '待匹配'}
                          </span>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="channel-progress-match"
                            onClick={() => setActiveRow(row)}
                          >
                            {row.matchedRecordId ? '重新核对' : '开始核对'}
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeRow && (
        <MatchDialog
          sourceRow={activeRow}
          month={snapshot.month}
          records={channelRecords}
          onClose={() => setActiveRow(null)}
          onConfirm={handleConfirm}
          onEditBill={onEditBill}
          onCreateBill={onCreateBill}
        />
      )}
    </section>
  )
}

export default ChannelReconciliationProgressPanel
