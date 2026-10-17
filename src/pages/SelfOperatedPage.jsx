import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useAppState } from '@/app/AppStateContext.jsx'
import { VIEWS } from '@/app/routes.js'
import { apiGet, apiPost, apiPostMultipart, apiPut } from '@/lib/api/client.ts'
import './SelfOperatedPage.css'

const num = (value) => Number(value || 0)
const exactMoney = (value) => '¥' + num(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const compactMoney = (value) => {
  const n = num(value)
  if (Math.abs(n) < 10000) return exactMoney(n)
  return (n < 0 ? '-' : '') + '¥' + (Math.abs(n) / 10000).toLocaleString('zh-CN', { maximumFractionDigits: 2 }) + '万'
}
const monthName = (value) => String(value || '').replace('-', '年') + '月'
const thisMonth = new Date().toISOString().slice(0, 7)
const TABS = [
  ['overview', '经营总览'],
  ['profit', '游戏利润'],
  ['ads', '买量管理'],
  ['contracts', '合同关联']
]

function Amount({ value, unavailable = false }) {
  if (unavailable) return <span className="dax-unavailable">待核算</span>
  return <span title={exactMoney(value)} tabIndex={0} aria-label={exactMoney(value)}>{compactMoney(value)}</span>
}

function Metric({ title, value, note, unavailable = false }) {
  return (
    <div className="dax-metric">
      <div className="dax-metric-title">{title}</div>
      <strong className="dax-metric-number"><Amount value={value} unavailable={unavailable} /></strong>
      <div className="dax-metric-note">{note}</div>
    </div>
  )
}

export default function SelfOperatedPage() {
  const { setActiveView } = useAppState()
  const [month, setMonth] = useState(thisMonth)
  const [months, setMonths] = useState([])
  const [tab, setTab] = useState('overview')
  const [summary, setSummary] = useState(null)
  const [ads, setAds] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [search, setSearch] = useState('')
  const [adType, setAdType] = useState('spend')
  const [adAmount, setAdAmount] = useState('')
  const [adDate, setAdDate] = useState(month + '-01')
  const [adPlatform, setAdPlatform] = useState('TapTap')
  const [adGame, setAdGame] = useState('')
  const [adNote, setAdNote] = useState('')
  const [selectedGame, setSelectedGame] = useState(null)
  const [contractSearch, setContractSearch] = useState('')
  const [candidateList, setCandidateList] = useState([])
  const [candidateId, setCandidateId] = useState('')

  const refreshMonths = useCallback(async () => {
    const response = await apiGet('/api/self-operated/months')
    const found = (response.items || []).map((item) => item.month)
    setMonths(found)
    return found
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [result, adResult] = await Promise.all([
        apiGet('/api/self-operated/summary?month=' + encodeURIComponent(month)),
        apiGet('/api/self-operated/ad-ledger?month=' + encodeURIComponent(month))
      ])
      setSummary(result)
      setAds(adResult.items || [])
      setError('')
    } catch (err) {
      setError(err?.message || '自营渠道数据读取失败，请检查服务连接或稍后重试')
    } finally {
      setLoading(false)
    }
  }, [month])

  useEffect(() => {
    let active = true
    refreshMonths().then((values) => {
      if (active && values.length) setMonth(values[0])
    }).catch((err) => {
      if (active) setError(err?.message || '账期加载失败')
    })
    return () => { active = false }
  }, [refreshMonths])

  useEffect(() => {
    refresh()
    setAdDate(month + '-01')
    setSelectedGame(null)
    setCandidateList([])
    setCandidateId('')
  }, [refresh, month])

  const games = useMemo(() => (summary?.games || []).filter((item) => (
    (String(item.game_external_id) + String(item.game_name)).toLowerCase().includes(search.trim().toLowerCase())
  )), [summary, search])

  const importFiles = async (event) => {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    if (!files.length) return
    setBusy(true)
    setError('')
    try {
      let added = 0
      let duplicates = 0
      let importedMonths = []
      for (const file of files) {
        const form = new FormData()
        form.append('file', file)
        const result = await apiPostMultipart('/api/self-operated/import', form, { timeoutMs: 120000 })
        added += result.inserted || 0
        duplicates += result.duplicates || 0
        importedMonths = importedMonths.concat(result.months || [])
      }
      const values = await refreshMonths()
      const latest = [...new Set(importedMonths)].sort().reverse()[0]
      if (latest && latest !== month) setMonth(latest)
      else if (values.length && !months.length) setMonth(values[0])
      else await refresh()
      setMessage('导入完成：新增 ' + added + ' 笔，跳过重复 ' + duplicates + ' 笔。原始订单按订单号去重。')
    } catch (err) {
      setError(err?.message || '导入失败；不会修改已存在的订单')
    } finally {
      setBusy(false)
    }
  }

  const addAd = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await apiPost('/api/self-operated/ad-ledger', {
        expense_date: adDate,
        entry_type: adType,
        ad_platform: adPlatform,
        game_external_id: adType === 'spend' ? adGame : null,
        game_name: adType === 'spend' ? summary?.games?.find((g) => g.game_external_id === adGame)?.game_name || '' : null,
        amount: Number(adAmount),
        source_bank: adType === 'topup' ? '网商银行' : '',
        note: adNote
      })
      setMessage(adType === 'topup' ? '广告充值已记录为预付款，没有计入利润成本。' : '广告实际消耗已保存，并归属指定游戏。')
      setAdAmount('')
      setAdNote('')
      await refresh()
    } catch (err) {
      setError(err?.message || '保存失败')
    } finally {
      setBusy(false)
    }
  }

  const findContracts = async (game) => {
    setSelectedGame(game)
    setCandidateList([])
    setCandidateId('')
    setContractSearch(game.game_name)
    try {
      const result = await apiGet('/api/self-operated/contract-candidates?game_name=' + encodeURIComponent(game.game_name))
      setCandidateList(result.items || [])
      setError('')
    } catch (err) {
      setError(err?.message || '合同候选项加载失败')
    }
  }

  const searchContracts = async () => {
    if (!selectedGame) return
    setBusy(true)
    try {
      const result = await apiGet('/api/self-operated/contract-candidates?game_name=' + encodeURIComponent(contractSearch))
      setCandidateList(result.items || [])
      setError('')
    } catch (err) {
      setError(err?.message || '合同搜索失败')
    } finally {
      setBusy(false)
    }
  }

  const saveContract = async (status) => {
    if (!selectedGame) return
    if (status === 'linked' && !candidateId) {
      setError('请先选择已经录入的研发合同合作游戏')
      return
    }
    if (status === 'no_external_share' && !window.confirm('确定此款游戏在该账期不需要支付外部研发分成吗？')) return
    setBusy(true)
    try {
      await apiPut('/api/self-operated/contract-link', {
        settlement_month: month,
        game_external_id: selectedGame.game_external_id,
        settlement_status: status,
        contract_access_item_id: status === 'linked' ? candidateId : null,
        note: '自营渠道后台人工确认'
      })
      setMessage('已保存 ' + monthName(month) + ' 的合同关联；不会自动生成已确认研发账单。')
      setSelectedGame(null)
      await refresh()
    } catch (err) {
      setError(err?.message || '关联失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dax-shell">
      <div className="dax-toolbar">
        <div className="dax-context"><strong>自营渠道</strong><span>广州熊动科技有限公司 · 默认收款网商银行（对公）</span></div>
        <div className="dax-toolbar-actions">
          <select aria-label="选择账期" value={month} onChange={(e) => setMonth(e.target.value)}>
            {[...new Set([month, ...months])].sort().reverse().map((m) => <option key={m} value={m}>{monthName(m)}</option>)}
          </select>
          <label className={'dax-primary dax-upload' + (busy ? ' dax-disabled' : '')}>
            {busy ? '导入中…' : '导入订单 CSV'}
            <input disabled={busy} type="file" accept=".csv,text/csv" multiple hidden onChange={importFiles} />
          </label>
          <button type="button" onClick={refresh} disabled={busy}>刷新</button>
        </div>
      </div>
      {error && <div className="dax-alert dax-alert-error" role="alert">{error}</div>}
      {message && <div className="dax-alert dax-alert-ok" role="status">{message}<button type="button" onClick={() => setMessage('')} aria-label="关闭提示">×</button></div>}
      <div className="dax-metrics">
        <Metric title="游戏现金订单实付" value={summary?.cash_paid || 0} note={summary?.status === 'imported' ? (summary.cash_orders + ' 笔已支付现金订单，竹B不计') : '尚未导入账单'} />
        <Metric title="买量实际消耗" value={summary?.ad_spend || 0} note="广告充值属于预付款，不重复扣成本" />
        <Metric title="研发应付" unavailable note="统一在现有研发账单结算，待合同条款核实" />
        <Metric title="本月经营贡献" unavailable note="待关联研发应付、运营费用、退款及税费" />
      </div>
      <div className="dax-tabs" role="tablist" aria-label="自营渠道">
        {TABS.map(([id, name]) => <button key={id} role="tab" aria-selected={tab === id} type="button" className={tab === id ? 'dax-tab dax-active' : 'dax-tab'} onClick={() => setTab(id)}>{name}</button>)}
      </div>
      {loading && <div className="dax-loading" role="status">正在读取自营渠道业务台账…</div>}
      {!loading && tab === 'overview' && (
        <div className="dax-two-cols">
          <section className="dax-panel">
            <div className="dax-panel-head"><div><h2>游戏经营概览</h2><small>按大熊游戏ID汇总成功现金订单，充值面额不参与利润</small></div><input placeholder="搜索游戏名称 / ID" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
            <div className="dax-table-wrap"><table className="dax-table">
              <thead><tr><th>游戏 / ID</th><th>现金实付</th><th>现金订单</th><th>合同状态</th></tr></thead>
              <tbody>{games.length ? games.map((g) => <tr key={g.game_external_id}>
                <td><strong>{g.game_name}</strong><small>ID {g.game_external_id}</small></td>
                <td className="dax-money" title={exactMoney(g.cash_paid)}>{compactMoney(g.cash_paid)}</td>
                <td>{g.cash_orders}</td>
                <td><button type="button" className="dax-text-btn" onClick={() => { setTab('contracts'); findContracts(g) }}>{g.contract_status === 'linked' ? '已关联合同' : g.contract_status === 'no_external_share' ? '无需外部分成' : '待关联合同'} →</button></td>
              </tr>) : <tr><td colSpan="4">{summary?.status === 'no_import' ? '尚未导入当月游戏订单' : '没有符合条件的游戏'}</td></tr>}</tbody>
            </table></div>
          </section>
          <aside className="dax-side">
            <section className="dax-panel dax-info">
              <h3>月结待办</h3>
              <p>1. 导入当月游戏订单和代币充值 CSV</p>
              <p>2. 核实订单异常及对应合同</p>
              <p>3. 广告实际消耗关联游戏</p>
              <p>4. 研发草稿统一进入原「研发账单」</p>
            </section>
            <section className="dax-panel dax-info">
              <h3>代币与异常单列</h3>
              <div><span>代币充值实付</span><b title={exactMoney(summary?.token_topups || 0)}>{compactMoney(summary?.token_topups || 0)}</b></div>
              <div><span>竹B订单消耗字段</span><b>{exactMoney(summary?.bamboo_used || 0)}</b></div>
              <div><span>未成功 / 待核订单</span><b>{summary?.abnormal_orders || 0} 笔</b></div>
              <p>竹B消费和代币购买不会同时确认为现金订单收入。</p>
            </section>
          </aside>
        </div>
      )}
      {!loading && tab === 'profit' && (
        <div className="dax-two-cols">
          <section className="dax-panel">
            <div className="dax-panel-head"><div><h2>游戏经营贡献预核算</h2><small>合同、研发账单及运营费用未完成关联前，不出具误导性的净利润</small></div></div>
            <div className="dax-table-wrap"><table className="dax-table"><thead><tr><th>游戏</th><th>现金实付</th><th>研发应付</th><th>买量消耗</th><th>经营贡献</th></tr></thead>
              <tbody>{(summary?.games || []).map((g) => <tr key={g.game_external_id}><td>{g.game_name}</td><td title={exactMoney(g.cash_paid)}>{compactMoney(g.cash_paid)}</td><td>待关联合同</td><td>{exactMoney(ads.filter((x) => x.entry_type === 'spend' && x.game_external_id === g.game_external_id).reduce((a,x) => a + num(x.amount), 0))}</td><td className="dax-pending">待核算</td></tr>)}</tbody>
            </table></div>
          </section>
          <aside className="dax-side"><section className="dax-panel dax-info"><h3>平台经营贡献</h3><div><span>现金订单实付</span><b>{compactMoney(summary?.cash_paid || 0)}</b></div><div><span>广告实际消耗</span><b>- {exactMoney(summary?.ad_spend || 0)}</b></div><div><span>研发应付</span><b>待核实</b></div><div><span>运营费用</span><b>来自现有运营费用</b></div><div><span>经营利润</span><b className="dax-pending">待核算</b></div><button onClick={() => setActiveView(VIEWS.PROFIT_ANALYSIS)}>查看原有总平台利润 →</button></section></aside>
        </div>
      )}
      {!loading && tab === 'ads' && (
        <div className="dax-two-cols">
          <section className="dax-panel">
            <div className="dax-panel-head"><div><h2>买量记录</h2><small>TapTap、巨量等广告充值与实际消耗独立管理</small></div></div>
            <div className="dax-table-wrap"><table className="dax-table"><thead><tr><th>日期</th><th>类型</th><th>平台 / 游戏</th><th>金额</th></tr></thead><tbody>
              {ads.length ? ads.map((item) => <tr key={item.id}><td>{item.expense_date}</td><td>{item.entry_type === 'topup' ? '账户充值（预付款）' : '实际消耗（成本）'}</td><td><strong>{item.ad_platform}</strong><small>{item.game_name || '广告账户'}</small></td><td title={exactMoney(item.amount)}>{compactMoney(item.amount)}</td></tr>) : <tr><td colSpan="4">本月暂无广告记录</td></tr>}
            </tbody></table></div>
          </section>
          <aside className="dax-side">
            <form className="dax-panel dax-form" onSubmit={addAd}>
              <h3>新增买量记录</h3>
              <label>业务类型<select value={adType} onChange={(e) => setAdType(e.target.value)}><option value="spend">广告实际消耗（成本）</option><option value="topup">广告账户充值（预付款）</option></select></label>
              <label>发生日期<input type="date" required value={adDate} onChange={(e) => setAdDate(e.target.value)} min={month + '-01'} max={month + '-31'} /></label>
              <label>金额（元）<input type="number" min="0.01" step="0.01" required placeholder="0.00" value={adAmount} onChange={(e) => setAdAmount(e.target.value)} /></label>
              <label>广告平台<input required value={adPlatform} onChange={(e) => setAdPlatform(e.target.value)} /></label>
              {adType === 'spend' && <label>归属游戏<select required value={adGame} onChange={(e) => setAdGame(e.target.value)}><option value="">选择大熊游戏</option>{(summary?.games || []).map((g) => <option key={g.game_external_id} value={g.game_external_id}>{g.game_name}</option>)}</select></label>}
              <label>备注<input value={adNote} onChange={(e) => setAdNote(e.target.value)} /></label>
              <button type="submit" className="dax-primary" disabled={busy}>{busy ? '保存中…' : '保存记录'}</button>
              <small>服务器、CDN、域名继续使用现有「运营费用」，不重复录入。</small>
            </form>
          </aside>
        </div>
      )}
      {!loading && tab === 'contracts' && (
        <div className="dax-two-cols">
          <section className="dax-panel">
            <div className="dax-panel-head"><div><h2>游戏合同映射</h2><small>{monthName(month)} · 按游戏ID匹配现有合同，历史账期独立</small></div></div>
            <div className="dax-table-wrap"><table className="dax-table"><thead><tr><th>游戏 / ID</th><th>现金实付</th><th>关联状态</th><th>操作</th></tr></thead><tbody>
              {(summary?.games || []).map((g) => <tr key={g.game_external_id}><td><strong>{g.game_name}</strong><small>ID {g.game_external_id}</small></td><td>{compactMoney(g.cash_paid)}</td><td>{g.contract_status === 'linked' ? '已关联合同' : g.contract_status === 'no_external_share' ? '已确认无需分成' : '待确认'}</td><td><button className="dax-text-btn" type="button" onClick={() => findContracts(g)}>选择合同 →</button></td></tr>)}
            </tbody></table></div>
          </section>
          <aside className="dax-side">
            <section className="dax-panel dax-form">
              <h3>关联研发合同</h3>
              {selectedGame ? <>
                <p><strong>{selectedGame.game_name}</strong>（ID {selectedGame.game_external_id}）</p>
                <label>查找现有合同合作游戏<input value={contractSearch} onChange={(e) => setContractSearch(e.target.value)} /></label>
                <button type="button" disabled={busy} onClick={searchContracts}>查找合同</button>
                <label>选择已录入的合同<select value={candidateId} onChange={(e) => setCandidateId(e.target.value)}><option value="">请选择，不能按厂商名称自动确认</option>{candidateList.map((c) => <option key={c.id} value={c.id}>{c.product_name} · {c.settlement_basis || '合同口径待确认'}</option>)}</select></label>
                <button type="button" className="dax-primary" disabled={busy || !candidateId} onClick={() => saveContract('linked')}>确认关联合同</button>
                <button type="button" disabled={busy} onClick={() => saveContract('no_external_share')}>确认无需外部分成</button>
              </> : <p>点击左侧某款游戏的「选择合同」。此处只记录关联，不自动写入研发应付账单。</p>}
              <button type="button" onClick={() => setActiveView(VIEWS.RECON_RD)}>打开统一研发账单 →</button>
            </section>
          </aside>
        </div>
      )}
      <footer className="dax-footer">自营渠道独立账本 · 订单按原订单号去重 · 网商银行到账核对仍归「银行中心」 · 研发、发票、付款仍归原有业务模块</footer>
    </div>
  )
}