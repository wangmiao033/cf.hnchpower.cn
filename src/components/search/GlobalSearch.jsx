import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useAppState } from '@/app/AppStateContext.jsx'
import { VIEWS } from '@/app/routes.js'
import { globalSearch } from '@/lib/api/globalSearch.ts'
import { stashInvoiceFocus } from '@/lib/exceptions/navFocus.ts'
import {
  stashBankTransactionFocus,
  stashContractFocus,
  stashPartnerFocus
} from '@/lib/search/globalSearchFocus.ts'
import './GlobalSearch.css'

const KIND_META = {
  contract: { label: '合同', mark: '合' },
  rd_bill: { label: '研发账单', mark: '研' },
  channel_bill: { label: '渠道账单', mark: '渠' },
  invoice: { label: '发票', mark: '票' },
  partner: { label: '客户', mark: '客' },
  bank_transaction: { label: '银行流水', mark: '流' }
}

const EXAMPLES = ['HT-202608-0001', '魔法启示录', '上海圆戏', '发票号码 / 流水号']

function formatMoney(value) {
  if (value === null || value === undefined || value === '') return ''
  const number = Number(value)
  if (!Number.isFinite(number)) return ''
  return `¥${number.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`
}

function GlobalSearch() {
  const { setActiveView, openBill360, showToast } = useAppState()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [response, setResponse] = useState({ results: [], groups: [], total: 0 })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef(null)
  const requestVersionRef = useRef(0)

  const results = response.results || []
  const groupCountMap = useMemo(
    () => Object.fromEntries((response.groups || []).map((item) => [item.kind, item.count])),
    [response.groups]
  )

  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen((current) => !current)
        return
      }
      if (event.key === 'Escape' && open) {
        event.preventDefault()
        setOpen(false)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    const id = window.requestAnimationFrame(() => inputRef.current?.focus())
    return () => window.cancelAnimationFrame(id)
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    const trimmed = query.trim()
    if (!trimmed) {
      requestVersionRef.current += 1
      setResponse({ results: [], groups: [], total: 0 })
      setError('')
      setLoading(false)
      setActiveIndex(0)
      return undefined
    }

    const version = requestVersionRef.current + 1
    requestVersionRef.current = version
    const timer = window.setTimeout(() => {
      setLoading(true)
      setError('')
      void globalSearch(trimmed, 30)
        .then((data) => {
          if (requestVersionRef.current !== version) return
          setResponse(data || { results: [], groups: [], total: 0 })
          setActiveIndex(0)
        })
        .catch((searchError) => {
          if (requestVersionRef.current !== version) return
          console.error(searchError)
          setResponse({ results: [], groups: [], total: 0 })
          setError(searchError?.message || '搜索暂时不可用，请稍后重试')
        })
        .finally(() => {
          if (requestVersionRef.current === version) setLoading(false)
        })
    }, 220)

    return () => window.clearTimeout(timer)
  }, [open, query])

  const close = () => {
    setOpen(false)
    setError('')
  }

  const navigateToResult = (item) => {
    const target = item?.target
    if (!target?.action || !target.entity_id) return

    if (target.action === 'bill360') {
      openBill360?.(target.bill_type === 'channel' ? 'channel' : 'rd', target.entity_id)
      return
    }
    if (target.action === 'contract_detail') {
      if (setActiveView?.(VIEWS.CONTRACTS) !== false) stashContractFocus(target.entity_id)
      return
    }
    if (target.action === 'invoice_detail') {
      const view = target.direction === 'input' ? VIEWS.INVOICE_INPUT : VIEWS.INVOICE_MANAGE
      if (setActiveView?.(view) !== false) stashInvoiceFocus(target.entity_id)
      return
    }
    if (target.action === 'partner_focus') {
      if (setActiveView?.(VIEWS.PARTNER_CONTACTS) !== false) {
        stashPartnerFocus(target.focus_query || item.title)
      }
      return
    }
    if (target.action === 'bank_detail') {
      if (setActiveView?.(VIEWS.BANK_TRANSACTIONS_LEDGER) !== false) {
        stashBankTransactionFocus(target.entity_id)
      }
      return
    }
    showToast?.('这个搜索结果暂时没有可打开的目标', 'info')
  }

  const choose = (item) => {
    if (!item) return
    close()
    navigateToResult(item)
  }

  const handleInputKeyDown = (event) => {
    if (!results.length) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((index) => Math.min(results.length - 1, index + 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((index) => Math.max(0, index - 1))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      choose(results[activeIndex])
    }
  }

  return (
    <>
      <button
        type="button"
        className="global-search-trigger"
        onClick={() => setOpen(true)}
        aria-label="全局搜索"
        title="全局搜索（Cmd/Ctrl + K）"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="6.5" />
          <path d="m16 16 4 4" />
        </svg>
        <span>搜索合同、账单、客户…</span>
        <kbd>⌘K</kbd>
      </button>

      {open ? (
        <div className="global-search-mask" role="presentation" onMouseDown={close}>
          <section
            className="global-search-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="全局业务搜索"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="global-search-input-row">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="11" cy="11" r="6.5" />
                <path d="m16 16 4 4" />
              </svg>
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={handleInputKeyDown}
                placeholder="输入合同编号、游戏、客户、账单号、发票号或银行流水号"
                autoComplete="off"
                spellCheck="false"
              />
              {loading ? <span className="global-search-loading">搜索中…</span> : null}
              <button type="button" className="global-search-close" onClick={close} aria-label="关闭搜索">Esc</button>
            </div>

            {query.trim() && !error && response.groups?.length ? (
              <div className="global-search-groups" aria-label="搜索结果分类">
                {Object.entries(KIND_META).map(([kind, meta]) =>
                  groupCountMap[kind] ? (
                    <span key={kind}>{meta.label} {groupCountMap[kind]}</span>
                  ) : null
                )}
              </div>
            ) : null}

            <div className="global-search-body">
              {!query.trim() ? (
                <div className="global-search-empty global-search-empty--intro">
                  <strong>搜索整个业务后台</strong>
                  <p>支持合同、研发/渠道账单、发票、客户和银行流水；搜索结果会按你的账号权限自动过滤。</p>
                  <div className="global-search-examples">
                    {EXAMPLES.map((example) => (
                      <button type="button" key={example} onClick={() => setQuery(example)}>{example}</button>
                    ))}
                  </div>
                </div>
              ) : error ? (
                <div className="global-search-empty is-error">
                  <strong>搜索没有完成</strong>
                  <p>{error}</p>
                </div>
              ) : !loading && results.length === 0 ? (
                <div className="global-search-empty">
                  <strong>没有找到“{query.trim()}”</strong>
                  <p>可以换成合同编号、客户简称、游戏名、发票号码或流水号再试。</p>
                </div>
              ) : (
                <div className="global-search-results" role="listbox" aria-label="全局搜索结果">
                  {results.map((item, index) => {
                    const meta = KIND_META[item.kind] || { label: item.badge || '结果', mark: '搜' }
                    const active = index === activeIndex
                    return (
                      <button
                        type="button"
                        key={item.id}
                        role="option"
                        aria-selected={active}
                        className={`global-search-result ${active ? 'is-active' : ''}`}
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => choose(item)}
                      >
                        <span className={`global-search-result__mark is-${item.kind}`} aria-hidden="true">{meta.mark}</span>
                        <span className="global-search-result__copy">
                          <span className="global-search-result__title-line">
                            <strong>{item.title}</strong>
                            <em>{item.badge || meta.label}</em>
                          </span>
                          <span className="global-search-result__subtitle">{item.subtitle || meta.label}</span>
                          <small>
                            {[item.meta, item.matched_fields?.length ? `命中：${item.matched_fields.join('、')}` : '']
                              .filter(Boolean)
                              .join(' · ')}
                          </small>
                        </span>
                        <span className="global-search-result__right">
                          {item.amount !== null && item.amount !== undefined ? <strong>{formatMoney(item.amount)}</strong> : null}
                          {item.status ? <small>{item.status}</small> : null}
                          <i aria-hidden="true">↵</i>
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            <footer className="global-search-footer">
              <span><kbd>↑</kbd><kbd>↓</kbd> 选择</span>
              <span><kbd>Enter</kbd> 打开</span>
              <span><kbd>Esc</kbd> 关闭</span>
              <strong>{results.length ? `${results.length} 个最相关结果` : 'V2.5-2 全局搜索'}</strong>
            </footer>
          </section>
        </div>
      ) : null}
    </>
  )
}

export default GlobalSearch
