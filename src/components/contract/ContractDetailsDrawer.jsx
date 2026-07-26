import React from 'react'
import ContractStatusTag from './ContractStatusTag.jsx'

function DetailRow({ label, value }) {
  return (
    <div className="contract-detail-row">
      <span className="contract-detail-label">{label}</span>
      <span className="contract-detail-value">{value || '-'}</span>
    </div>
  )
}

function formatAmount(value) {
  if (value === null || value === undefined || value === '') return '-'
  return `¥ ${Number(value).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`
}

function ContractDetailsDrawer({ contract, onClose, onEdit }) {
  if (!contract) return null

  return (
    <div className="contract-drawer-mask" onClick={onClose}>
      <aside
        className="contract-drawer"
        aria-label="合同详情"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="contract-drawer-head">
          <div>
            <p>合同详情</p>
            <h3>{contract.contract_name || '-'}</h3>
            <div className="contract-drawer-badges">
              <ContractStatusTag status={contract.timeline_status} />
              {contract.partner_link_status === 'linked' ? (
                <span className="contract-link-badge">已关联客户库</span>
              ) : (
                <span className="contract-link-badge is-unlinked">未关联客户</span>
              )}
              {contract.contract_no_duplicate ? (
                <span className="contract-duplicate-badge">编号重复待核验</span>
              ) : null}
            </div>
          </div>
          <button type="button" onClick={onClose}>关闭</button>
        </div>

        <div className="contract-drawer-amount">
          <span>合同总额</span>
          <strong>{formatAmount(contract.amount)}</strong>
          <small>{contract.payment_type || '账款类型未填写'}</small>
        </div>

        <div className="contract-drawer-section">
          <h4>基础信息</h4>
          <DetailRow label="合同编号" value={contract.contract_no} />
          <DetailRow label="合同类型" value={contract.contract_type} />
          <DetailRow label="签订状态" value={contract.signing_status} />
          <DetailRow label="履约状态" value={contract.performance_status} />
          <DetailRow label="数据来源" value={contract.source === 'wps' ? 'WPS 合同台账' : '手工录入'} />
        </div>

        <div className="contract-drawer-section">
          <h4>合同主体</h4>
          <DetailRow label="签约方" value={contract.counterparty} />
          <DetailRow label="客户简称" value={contract.partner_short_name} />
          <DetailRow label="关联客户" value={contract.partner_name} />
        </div>

        <div className="contract-drawer-section">
          <h4>关键日期</h4>
          <DetailRow label="签订日期" value={contract.signing_date} />
          <DetailRow label="生效日期" value={contract.effective_date} />
          <DetailRow label="终止日期" value={contract.end_date} />
        </div>

        <div className="contract-drawer-section">
          <h4>合同附件</h4>
          {contract.attachments?.length ? (
            <ul className="contract-attachment-list">
              {contract.attachments.map((attachment) => (
                <li key={attachment}>{attachment}</li>
              ))}
            </ul>
          ) : (
            <p className="contract-placeholder">暂无附件名称</p>
          )}
        </div>

        <div className="contract-drawer-actions">
          <button type="button" className="is-primary" onClick={() => onEdit?.(contract)}>
            编辑合同
          </button>
          <button type="button" onClick={onClose}>返回列表</button>
        </div>
      </aside>
    </div>
  )
}

export default ContractDetailsDrawer
