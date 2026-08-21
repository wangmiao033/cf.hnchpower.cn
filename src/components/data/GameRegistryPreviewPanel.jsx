import React, { useEffect, useMemo, useState } from 'react'
import { getGameRegistryHistoryPreview } from '@/lib/api/gameRegistry.ts'
import './GameRegistryPreviewPanel.css'

function number(value) {
  return Number(value || 0).toLocaleString('zh-CN')
}

function percent(value) {
  if (value === null || value === undefined || value === '') return '-'
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return String(value)
  return `${parsed.toFixed(parsed % 1 === 0 ? 0 : 2)}%`
}

function period(startMonth, endMonth) {
  if (!startMonth) return '-'
  if (!endMonth || startMonth === endMonth) return startMonth
  return `${startMonth} ～ ${endMonth}`
}

function ruleLabel(rule) {
  const parts = [
    `分成 ${percent(rule.share_rate)}`,
    `税率 ${percent(rule.tax_rate)}`,
    `渠道费 ${percent(rule.channel_fee_rate)}`
  ]
  if (rule.settlement_rule_code) parts.push(String(rule.settlement_rule_code))
  return parts.join(' · ')
}

function GameRegistryPreviewPanel() {
  const [preview, setPreview] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [partnerName, setPartnerName] = useState('')
  const [channelName, setChannelName] = useState('')
  const [appliedFilters, setAppliedFilters] = useState({ partner_name: '', channel_name: '' })
  const [activeSection, setActiveSection] = useState('games')

  const load = async (filters = appliedFilters) => {
    setLoading(true)
    setError('')
    try {
      const result = await getGameRegistryHistoryPreview({
        partner_name: filters.partner_name || undefined,
        channel_name: filters.channel_name || undefined,
        confirmed_only: true
      })
      setPreview(result)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '历史规则扫描失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load({ partner_name: '', channel_name: '' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const summary = preview?.summary || {}
  const games = preview?.games || []
  const rules = preview?.rules || []
  const conflicts = preview?.conflicts || []
  const legacyCount = Number(summary.legacy_records_without_line_items || 0)
  const hasConflict = Number(summary.conflict_count || 0) > 0

  const channelCount = useMemo(() => {
    const keys = new Set()
    games.forEach((game) => {
      ;(game.channels || []).forEach((channel) => {
        keys.add(`${channel.partner_name || ''}::${channel.channel_name || ''}`)
      })
    })
    return keys.size
  }, [games])

  const applyFilters = () => {
    const next = {
      partner_name: partnerName.trim(),
      channel_name: channelName.trim()
    }
    setAppliedFilters(next)
    load(next)
  }

  const resetFilters = () => {
    const next = { partner_name: '', channel_name: '' }
    setPartnerName('')
    setChannelName('')
    setAppliedFilters(next)
    load(next)
  }

  return (
    <div className="gr-preview">
      <section className="gr-safety-banner">
        <div className="gr-safety-icon">只读</div>
        <div>
          <strong>当前为 V4 历史规则验证模式</strong>
          <p>只读取“已确认”的渠道账单生成候选游戏与规则区间，不回写、不重算、不修改历史金额。</p>
        </div>
        <button type="button" onClick={() => load()} disabled={loading}>
          {loading ? '扫描中…' : '重新扫描'}
        </button>
      </section>

      <section className="gr-filter-bar" aria-label="历史扫描筛选">
        <label>
          <span>合作方</span>
          <input
            value={partnerName}
            onChange={(event) => setPartnerName(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && applyFilters()}
            placeholder="可选，例如：厦门三七三三"
          />
        </label>
        <label>
          <span>渠道</span>
          <input
            value={channelName}
            onChange={(event) => setChannelName(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && applyFilters()}
            placeholder="可选，例如：3733游戏"
          />
        </label>
        <button type="button" className="gr-filter-primary" onClick={applyFilters} disabled={loading}>筛选扫描</button>
        <button type="button" className="gr-filter-secondary" onClick={resetFilters} disabled={loading}>重置</button>
      </section>

      {error ? <div className="gr-message gr-message-error">{error}</div> : null}

      <section className="gr-summary" aria-label="游戏库扫描概览">
        <article>
          <span>历史明细</span>
          <strong>{loading && !preview ? '…' : number(summary.source_line_count)}</strong>
          <small>已确认渠道账单明细</small>
        </article>
        <article>
          <span>识别游戏</span>
          <strong>{number(summary.game_count)}</strong>
          <small>保持版本后缀独立</small>
        </article>
        <article>
          <span>涉及渠道</span>
          <strong>{number(channelCount)}</strong>
          <small>按合作方 + 渠道隔离</small>
        </article>
        <article>
          <span>规则区间</span>
          <strong>{number(summary.rule_period_count)}</strong>
          <small>仅合并连续同规则月份</small>
        </article>
        <article className={hasConflict ? 'is-warning' : 'is-ok'}>
          <span>待确认冲突</span>
          <strong>{number(summary.conflict_count)}</strong>
          <small>{hasConflict ? '同月存在不同规则' : '未发现同月规则冲突'}</small>
        </article>
      </section>

      {legacyCount > 0 ? (
        <div className="gr-message gr-message-warning">
          另有 <strong>{number(legacyCount)}</strong> 张历史渠道账单没有游戏明细行，本阶段不会自动猜规则，也不会纳入候选游戏库。
        </div>
      ) : null}

      <nav className="gr-sections" aria-label="游戏库预览分类">
        <button type="button" className={activeSection === 'games' ? 'is-active' : ''} onClick={() => setActiveSection('games')}>
          游戏库 <b>{number(summary.game_count)}</b>
        </button>
        <button type="button" className={activeSection === 'rules' ? 'is-active' : ''} onClick={() => setActiveSection('rules')}>
          渠道规则 <b>{number(summary.rule_period_count)}</b>
        </button>
        <button type="button" className={activeSection === 'conflicts' ? 'is-active' : ''} onClick={() => setActiveSection('conflicts')}>
          冲突待确认 <b>{number(summary.conflict_count)}</b>
        </button>
      </nav>

      {activeSection === 'games' ? (
        <section className="gr-panel">
          <header>
            <div>
              <h2>候选游戏库</h2>
              <p>这里只做名称归一化预览；不会把“0.05折”“3折”等不同版本自动合并。</p>
            </div>
            <span>{games.length} 款</span>
          </header>
          <div className="gr-table-wrap">
            <table>
              <thead>
                <tr><th>游戏名称</th><th>历史名称</th><th>渠道数</th><th>历史出现</th></tr>
              </thead>
              <tbody>
                {games.map((game) => (
                  <tr key={game.normalized_name}>
                    <td><strong>{game.canonical_name}</strong></td>
                    <td>
                      <div className="gr-tags">
                        {(game.display_variants || []).slice(0, 4).map((name) => <span key={name}>{name}</span>)}
                        {(game.display_variants || []).length > 4 ? <span>+{game.display_variants.length - 4}</span> : null}
                      </div>
                    </td>
                    <td>{number(game.channel_count)}</td>
                    <td>{number(game.occurrences)} 条</td>
                  </tr>
                ))}
                {!loading && games.length === 0 ? <tr><td className="gr-empty" colSpan="4">当前筛选条件下没有可整理的已确认历史明细</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {activeSection === 'rules' ? (
        <section className="gr-panel">
          <header>
            <div>
              <h2>渠道 × 游戏 × 月份规则</h2>
              <p>同一游戏在不同渠道可使用不同分成；同一渠道规则变化后按月份拆成新的有效区间。</p>
            </div>
            <span>{rules.length} 段</span>
          </header>
          <div className="gr-table-wrap">
            <table>
              <thead>
                <tr><th>合作方 / 渠道</th><th>游戏</th><th>有效月份</th><th>分成</th><th>税率</th><th>渠道费</th><th>依据</th></tr>
              </thead>
              <tbody>
                {rules.map((rule, index) => (
                  <tr key={`${rule.partner_name}-${rule.channel_name}-${rule.normalized_name}-${rule.start_month}-${index}`}>
                    <td><strong>{rule.channel_name || '-'}</strong><small className="gr-subline">{rule.partner_name || '-'}</small></td>
                    <td>{rule.game_name}</td>
                    <td><code>{period(rule.start_month, rule.end_month)}</code></td>
                    <td><strong>{percent(rule.share_rate)}</strong></td>
                    <td>{percent(rule.tax_rate)}</td>
                    <td>{percent(rule.channel_fee_rate)}</td>
                    <td>{number(rule.source_count)} 条 / {(rule.source_months || []).length} 月</td>
                  </tr>
                ))}
                {!loading && rules.length === 0 ? <tr><td className="gr-empty" colSpan="7">当前没有可形成确定规则区间的数据</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {activeSection === 'conflicts' ? (
        <section className="gr-panel gr-conflict-panel">
          <header>
            <div>
              <h2>冲突待确认</h2>
              <p>同一合作方、渠道、游戏、月份出现两套或以上规则时，只列出来，不自动选任何一套。</p>
            </div>
            <span>{conflicts.length} 处</span>
          </header>
          <div className="gr-conflict-list">
            {conflicts.map((conflict) => (
              <article key={`${conflict.partner_name}-${conflict.channel_name}-${conflict.normalized_name}-${conflict.month}`}>
                <div className="gr-conflict-title">
                  <div>
                    <strong>{conflict.game_name}</strong>
                    <span>{conflict.partner_name || '-'} · {conflict.channel_name || '-'}</span>
                  </div>
                  <code>{conflict.month}</code>
                </div>
                <div className="gr-conflict-variants">
                  {(conflict.variants || []).map((variant, index) => (
                    <div key={`${ruleLabel(variant)}-${index}`}>
                      <b>方案 {index + 1}</b>
                      <span>{ruleLabel(variant)}</span>
                      <small>{number(variant.count)} 条历史明细{variant.bill_ids?.length ? ` · ${variant.bill_ids.length} 张账单` : ''}</small>
                    </div>
                  ))}
                </div>
              </article>
            ))}
            {!loading && conflicts.length === 0 ? (
              <div className="gr-conflict-empty">
                <strong>当前没有规则冲突</strong>
                <span>可以继续核对候选游戏和规则区间，但本阶段仍不会自动写入正式规则。</span>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  )
}

export default GameRegistryPreviewPanel
