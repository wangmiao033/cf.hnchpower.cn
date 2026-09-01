import React from 'react'
import { getContractRuleReadiness } from '@/domain/contract/contractRuleReadiness.js'
import './ContractRuleReadinessNotice.css'

function partnerLinked(contract) {
  return contract?.partner_link_status === 'linked' || Boolean(contract?.partner_id)
}

export default function ContractRuleReadinessNotice({ form, contract }) {
  const readiness = getContractRuleReadiness(form, { partnerLinked: partnerLinked(contract) })
  const details = [...readiness.issues, ...readiness.warnings]

  return (
    <div className={`contract-rule-readiness is-${readiness.level}`}>
      <div className="contract-rule-readiness__head">
        <span>{readiness.level === 'complete' ? '✓' : readiness.level === 'usable' ? '!' : '×'}</span>
        <div>
          <strong>{readiness.label}</strong>
          <small>
            {readiness.ready
              ? '这条合作清单已经具备渠道账单自动匹配与结算规则带入的关键条件。'
              : '自动匹配必填：已关联客户、合作游戏、合作渠道、版本、完整授权期、结算规则/分成。'}
          </small>
        </div>
        <em>{readiness.missingCount ? `${readiness.missingCount} 项待完善` : '规则完整'}</em>
      </div>

      {details.length ? (
        <div className="contract-rule-readiness__items">
          {readiness.issues.map((item) => <span className="is-blocking" key={`block-${item}`}>{item}</span>)}
          {readiness.warnings.map((item) => <span key={`warn-${item}`}>{item}</span>)}
        </div>
      ) : null}

      {!readiness.ready ? (
        <p>红色项会直接影响渠道账单自动匹配；版本不区分时请选择“全版本”，通道费没有时填 0。</p>
      ) : readiness.warnings.length ? (
        <p>当前已经可用于自动对账；建议项补齐后，后续发票、账期和收付款判断会更准确。</p>
      ) : null}
    </div>
  )
}
