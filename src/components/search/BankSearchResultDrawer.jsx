import React from 'react'
import './BankSearchResultDrawer.css'

const TYPE_LABEL = {
  statement_import: '银行流水',
  payment_register: '银行付款',
  collection_register: '银行回款'
}

function money(row) {
  const value = Number(row?.expense_amount || row?.income_amount || row?.amount || 0)
  return `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function text(value, fallback = '-') {
  const raw = value == null ? '' : String(value).trim()
  return raw || fallback
}

export default function BankSearchResultDrawer({ transaction, onClose, onOpenLedger }) {
  if (!transaction) return null
  return (
    <div className="bank-search-result-mask" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose?.()
    }}>
      <aside className="bank-search-result-drawer" role="dialog" aria-modal="true" aria-label="银行流水搜索结果详情">
        <header>
          <div>
            <span>GLOBAL SEARCH · BANK DETAIL</span>
            <h2>银行流水详情</h2>
            <p>{text(transaction.transaction_no || transaction.instruction_no, `ID ${transaction.id}`)}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭">×</button>
        </header>
        <main>
          <section className="bank-search-result-hero">
            <div><span>类型</span><strong>{TYPE_LABEL[transaction.type] || text(transaction.type)}</strong></div>
            <div><span>交易日期</span><strong>{text(transaction.trade_date)}</strong></div>
            <div><span>金额</span><strong>{money(transaction)}</strong></div>
            <div><span>状态</span><strong>{text(transaction.status)}</strong></div>
          </section>
          <section className="bank-search-result-card">
            <h3>交易对象</h3>
            <dl>
              <div><dt>付款方</dt><dd>{text(transaction.payer_name)}</dd></div>
              <div><dt>付款方账号</dt><dd>{text(transaction.payer_account)}</dd></div>
              <div><dt>收款方</dt><dd>{text(transaction.payee_name)}</dd></div>
              <div><dt>收款方账号</dt><dd>{text(transaction.payee_account)}</dd></div>
              <div><dt>本方账户</dt><dd>{text(transaction.bank_account)}</dd></div>
              <div><dt>币种</dt><dd>{text(transaction.currency, 'CNY')}</dd></div>
            </dl>
          </section>
          <section className="bank-search-result-card">
            <h3>业务信息</h3>
            <dl>
              <div><dt>流水号</dt><dd>{text(transaction.transaction_no)}</dd></div>
              <div><dt>指令编号</dt><dd>{text(transaction.instruction_no)}</dd></div>
              <div><dt>关联账单</dt><dd>{text(transaction.reconciliation_no)}</dd></div>
              <div><dt>摘要</dt><dd>{text(transaction.summary)}</dd></div>
              <div><dt>用途</dt><dd>{text(transaction.purpose)}</dd></div>
              <div><dt>备注</dt><dd>{text(transaction.remark)}</dd></div>
            </dl>
          </section>
        </main>
        <footer>
          <button type="button" onClick={onClose}>关闭</button>
          <button type="button" className="primary" onClick={() => onOpenLedger?.(transaction)}>打开银行台账</button>
        </footer>
      </aside>
    </div>
  )
}
