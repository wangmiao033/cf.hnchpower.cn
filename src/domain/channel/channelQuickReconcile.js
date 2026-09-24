export function quickReconcileEligible(record) {
  const status = String(record?.status || 'pending')
  return status === 'pending'
}

function numeric(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

export function hasQuickReconcileDataDifference(record) {
  if (String(record?.validationStatus || '') === 'fail') return true
  const headerDifference = numeric(record?.settlementDifference)
  if (headerDifference != null && Math.abs(headerDifference) > 0.01) return true
  return Array.isArray(record?.items) && record.items.some((item) => {
    if (String(item?.validationStatus || '') === 'fail') return true
    const difference = numeric(item?.settlementDifference)
    return difference != null && Math.abs(difference) > 0.01
  })
}

export function quickReconcileAssessment(record, state) {
  if (!state || state.loading) {
    return { tone: 'loading', label: '核验中', detail: '正在读取合同与金额核验结果' }
  }
  if (state.error) {
    return { tone: 'warning', label: '需人工确认', detail: '合同核验暂不可用，确认时仍会再次执行正式预检' }
  }

  const data = state.data || {}
  const summary = data.summary || {}
  const amountSummary = data.amount_summary || {}
  const explicitDifference = hasQuickReconcileDataDifference(record)
    || Number(summary.fail_count || 0) > 0
    || Number(summary.unresolved_difference_lines || 0) > 0
    || amountSummary.status === 'fail'

  if (explicitDifference) {
    const count = Number(summary.unresolved_difference_lines || summary.fail_count || 0)
    return {
      tone: 'danger',
      label: '存在差异',
      detail: count > 0 ? `${count} 项明确差异需要先处理` : '账单金额或平台结算存在明确差异'
    }
  }

  const warningCount = Number(summary.issue_count || 0)
    + Number(summary.unmatched_count || 0)
    + Number(summary.handled_difference_lines || 0)
  if (warningCount > 0) {
    return {
      tone: 'warning',
      label: '需人工确认',
      detail: `${warningCount} 项合同或匹配信息需要看一眼`
    }
  }

  return {
    tone: 'pass',
    label: '可直接通过',
    detail: '未发现明确合同或金额差异'
  }
}

export function quickReconcileCounts(records, checkStates = {}) {
  return (records || []).reduce((out, record) => {
    const tone = quickReconcileAssessment(record, checkStates[String(record?.id)]).tone
    out[tone] = (out[tone] || 0) + 1
    return out
  }, { pass: 0, warning: 0, danger: 0, loading: 0 })
}

function matchCheckLine(checkData, item, index) {
  const lines = Array.isArray(checkData?.lines) ? checkData.lines : []
  return lines.find((line) => String(line?.line_id || '') === String(item?.id || ''))
    || lines[index]
    || lines.find((line) => String(line?.game_name || '').trim() === String(item?.gameName || '').trim())
    || null
}

export function quickReconcileLineRows(record, checkData) {
  const items = Array.isArray(record?.items) ? record.items : []
  return items.map((item, index) => {
    const check = matchCheckLine(checkData, item, index)
    const expected = numeric(check?.contract_amount?.expected_amount)
      ?? numeric(item?.systemSettlementAmount)
      ?? numeric(item?.settlementAmount)
      ?? 0
    const platform = numeric(item?.platformSettlementAmount)
      ?? numeric(check?.contract_amount?.actual_amount)
      ?? null
    const difference = numeric(item?.settlementDifference)
      ?? (platform == null ? null : expected - platform)
    const contractName = check?.match?.contract_name || check?.match?.contract_no || ''
    const status = String(item?.validationStatus || '') === 'fail' || String(check?.status || '') === 'fail'
      ? 'danger'
      : check?.status === 'warning' || check?.status === 'unmatched'
        ? 'warning'
        : platform == null
          ? 'warning'
          : Math.abs(Number(difference || 0)) <= 0.01
            ? 'pass'
            : 'danger'

    return {
      key: String(item?.id || `${item?.gameName || 'game'}-${index}`),
      gameName: String(item?.gameName || check?.game_name || `第${index + 1}项`),
      flow: numeric(item?.flow) ?? numeric(item?.billingFlow) ?? 0,
      shareRate: numeric(item?.shareRate) ?? numeric(check?.match?.share_rate),
      expected,
      platform,
      difference,
      status,
      contractName
    }
  })
}
