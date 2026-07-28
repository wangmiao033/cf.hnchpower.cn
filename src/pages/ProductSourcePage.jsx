import React, { useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import PageContainer from '@/components/layout/PageContainer.jsx'
import {
  importProductSources,
  listProductSources
} from '@/lib/api/productSources.ts'
import './ProductSourcePage.css'

function dateTime(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
}

function cleanCode(value) {
  return String(value ?? '').trim().replace(/^'/, '')
}

function findHeader(headers, matcher) {
  return headers.find((header) => matcher(String(header).replace(/\s+/g, '').toLowerCase()))
}

function ProductSourcePage() {
  const fileInputRef = useRef(null)
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [allTotal, setAllTotal] = useState(0)
  const [latestImportAt, setLatestImportAt] = useState(null)
  const [keyword, setKeyword] = useState('')
  const [appliedKeyword, setAppliedKeyword] = useState('')
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [message, setMessage] = useState(null)

  const load = async (query = appliedKeyword, { keepMessage = false } = {}) => {
    setLoading(true)
    if (!keepMessage) setMessage(null)
    try {
      const result = await listProductSources({ q: query, limit: 500, offset: 0 })
      setRows(result.items || [])
      setTotal(Number(result.total || 0))
      if (!query) setAllTotal(Number(result.total || 0))
      setLatestImportAt(result.latest_import_at || null)
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '数据源读取失败'
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const sourceFile = useMemo(
    () => rows.find((row) => row.source_file)?.source_file || '游戏列表_QuickSDK_Code.xlsx',
    [rows]
  )

  const search = () => {
    const next = keyword.trim()
    setAppliedKeyword(next)
    load(next)
  }

  const reset = () => {
    setKeyword('')
    setAppliedKeyword('')
    load('')
  }

  const handleFile = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setImporting(true)
    setMessage(null)
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' })
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      const data = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false })
      const headers = data.length ? Object.keys(data[0]) : []
      const gameHeader = findHeader(headers, (header) => header === '游戏名称' || header.includes('游戏'))
      const codeHeader = findHeader(
        headers,
        (header) => header.includes('productcode') || header === 'product_code'
      )

      if (!gameHeader || !codeHeader) {
        throw new Error('Excel 必须包含“游戏名称”和“QuickSDK ProductCode”两列')
      }

      const importRows = data
        .map((item) => ({
          game_name: String(item[gameHeader] || '').trim(),
          product_code: cleanCode(item[codeHeader])
        }))
        .filter((item) => item.game_name && item.product_code)

      if (!importRows.length) {
        throw new Error('Excel 中没有可导入的游戏 ProductCode')
      }

      const result = await importProductSources({
        source_file: file.name,
        rows: importRows
      })
      setMessage({
        type: 'success',
        text: `导入完成：新增 ${result.inserted} 条，更新 ${result.updated} 条，跳过 ${result.skipped} 条`
      })
      setKeyword('')
      setAppliedKeyword('')
      await load('', { keepMessage: true })
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Excel 导入失败'
      })
    } finally {
      setImporting(false)
    }
  }

  return (
    <PageContainer hideHeader className="product-source-page">
      <section className="ps-head">
        <div className="ps-title">
          <span className="ps-title-icon">源</span>
          <div>
            <h1>数据源</h1>
            <p>QuickSDK 游戏名称与 ProductCode 原始台账，仅用于保存和核对源数据。</p>
          </div>
        </div>
        <div className="ps-actions">
          <input
            ref={fileInputRef}
            className="ps-file-input"
            type="file"
            accept=".xlsx,.xls"
            onChange={handleFile}
          />
          <button
            type="button"
            className="ps-primary"
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
          >
            {importing ? '导入中' : '导入 Excel'}
          </button>
        </div>
      </section>

      <section className="ps-overview" aria-label="数据源概览">
        <div>
          <span>ProductCode 总数</span>
          <strong>{allTotal.toLocaleString('zh-CN')}</strong>
          <small>按 ProductCode 唯一保存</small>
        </div>
        <div>
          <span>当前结果</span>
          <strong>{total.toLocaleString('zh-CN')}</strong>
          <small>{appliedKeyword ? `匹配“${appliedKeyword}”` : '显示全部游戏'}</small>
        </div>
        <div>
          <span>最近更新</span>
          <strong className="ps-date">{dateTime(latestImportAt)}</strong>
          <small>来源：{sourceFile}</small>
        </div>
      </section>

      <section className="ps-toolbar" aria-label="数据源筛选">
        <label>
          <span>搜索</span>
          <input
            type="search"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') search()
            }}
            placeholder="输入游戏名称或 QuickSDK ProductCode"
          />
        </label>
        <button type="button" className="ps-search" onClick={search} disabled={loading}>
          搜索
        </button>
        <button type="button" className="ps-reset" onClick={reset} disabled={loading}>
          重置
        </button>
      </section>

      {message ? (
        <div className={`ps-message ps-message-${message.type}`}>{message.text}</div>
      ) : null}

      <section className="ps-table-panel">
        <header>
          <div>
            <h2>QuickSDK ProductCode 台账</h2>
            <p>当前仅展示原始数据，不与数据库流水、账单或合同建立关联。</p>
          </div>
          <span>{loading ? '读取中' : `${total} 条`}</span>
        </header>

        <div className="ps-table-wrap">
          <table>
            <thead>
              <tr>
                <th>序号</th>
                <th>游戏名称</th>
                <th>QuickSDK ProductCode</th>
                <th>来源文件</th>
                <th>更新时间</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.id || row.product_code}>
                  <td>{index + 1}</td>
                  <td><strong>{row.game_name}</strong></td>
                  <td><code>{row.product_code}</code></td>
                  <td title={row.source_file || ''}>{row.source_file || '-'}</td>
                  <td>{dateTime(row.updated_at)}</td>
                </tr>
              ))}
              {!loading && rows.length === 0 ? (
                <tr>
                  <td className="ps-empty" colSpan="5">
                    {appliedKeyword ? '没有匹配的数据源记录' : '暂无数据，请导入 QuickSDK 游戏清单'}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </PageContainer>
  )
}

export default ProductSourcePage
