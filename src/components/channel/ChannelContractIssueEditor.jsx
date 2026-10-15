import React, { useEffect, useMemo, useState } from 'react'
import { listContracts, updateContractAccessItem } from '@/lib/api/contract.ts'
import { normalizeInlineKey } from '@/domain/channel/channelInlineResolution.js'
import {
  accessDataModified,
  candidateKey,
  checkContractAuthorizationForMonth,
  fullContractAccessUpdate,
  withContractReviewNote
} from '@/domain/channel/channelContractInlineReview.js'
import './ChannelContractIssueEditor.css'

const normalize = (value) => normalizeInlineKey(value).replace(/[()（）\s]/g, '')
const safeText = (value) => String(value ?? '').trim()
const matchedPartner = (contract, partnerName) => {
  const wanted = normalize(partnerName)
  if (!wanted) return false
  const names = [contract.partner_name, contract.partner_short_name, contract.counterparty]
    .map(normalize).filter(Boolean)
  return names.some(x => x === wanted || (x.length >= 5 && wanted.includes(x)) || (wanted.length >= 5 && x.includes(wanted)))
}

function findEntry(rows, contractId, itemId) {
  for (const contract of rows || []) {
    if (safeText(contract?.id) !== safeText(contractId)) continue
    for (const item of contract?.access_items || []) {
      if (safeText(item?.id) === safeText(itemId)) return { contract, item }
    }
  }
  return null
}

function availableChoices(rows, issue, partnerName) {
  const match = issue?.match || {}
  const baseGame = normalize(safeText(issue?.game_name).split(/[（(]/)[0])
  const all = (rows || []).flatMap(contract => (contract.access_items || []).map(item => ({ contract, item })))
  const similar = all.filter(({contract,item}) => {
    if (!matchedPartner(contract, partnerName)) return false
    const game = normalize(item.product_name)
    return Boolean(baseGame && game && (game.includes(baseGame) || baseGame.includes(game)))
  })
  const matched = findEntry(rows, match.contract_id, match.access_item_id)
  if (matched && !similar.some(x => candidateKey(x.contract,x.item) === candidateKey(matched.contract,matched.item))) similar.unshift(matched)
  return similar
}

export default function ChannelContractIssueEditor({ issue, partnerName, onClose, onSaved }) {
  const [choices, setChoices] = useState([])
  const [selectedKey, setSelectedKey] = useState('')
  const [fields, setFields] = useState({ product_name: '', channel_name: '', authorization_start: '', authorization_end: '' })
  const [evidence, setEvidence] = useState('')
  const [verified, setVerified] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const selected = useMemo(
    () => choices.find(({ contract,item }) => candidateKey(contract,item) === selectedKey) || null,
    [choices, selectedKey]
  )

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    const load = async () => {
      const first = await listContracts({ q: partnerName, limit: 100, offset: 0 })
      let rows = first.items || []
      let matched = findEntry(rows, issue.match?.contract_id, issue.match?.access_item_id)
      if (!matched && issue.match?.contract_name) {
        const second = await listContracts({ q: issue.match.contract_name, limit: 100, offset: 0 })
        rows = [...rows, ...(second.items || []).filter(x => !rows.some(existing => String(existing.id) === String(x.id)))]
      }
      const available = availableChoices(rows, issue, partnerName)
      if (!active) return
      if (!available.length) {
        setError('未能从合同库读取这条候选合作项，不能直接修改。请检查合同资料或重新匹配。')
        return
      }
      const current = available.find(({ contract,item }) => (
        String(contract.id) === String(issue.match?.contract_id) && String(item.id) === String(issue.match?.access_item_id)
      )) || available[0]
      setChoices(available)
      setSelectedKey(candidateKey(current.contract, current.item))
      setFields({
        product_name: safeText(current.item.product_name),
        channel_name: safeText(current.item.channel_name),
        authorization_start: safeText(current.item.authorization_start),
        authorization_end: safeText(current.item.authorization_end)
      })
    }
    load().catch(cause => {
      if (active) setError(cause instanceof Error ? cause.message : '读取候选合同失败')
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [issue, partnerName])

  const pickChoice = (key) => {
    const next = choices.find(({ contract,item }) => candidateKey(contract,item) === key)
    if (!next) return
    setSelectedKey(key)
    setFields({
      product_name: safeText(next.item.product_name),
      channel_name: safeText(next.item.channel_name),
      authorization_start: safeText(next.item.authorization_start),
      authorization_end: safeText(next.item.authorization_end)
    })
    setEvidence('')
    setVerified(false)
    setError('')
  }

  const save = async () => {
    if (!selected || saving) return
    setError('')
    setSaving(true)
    try {
      if (!verified) throw new Error('请先确认已经核对合同原件及这款游戏的合作归属')
      if (!safeText(fields.product_name)) throw new Error('请填写合同中真实的游戏名称')
      const dates = checkContractAuthorizationForMonth(issue.settlement_cycle, fields.authorization_start, fields.authorization_end)
      const changes = { ...fields, ...dates }
      if (!accessDataModified(selected.item, changes)) {
        throw new Error('合同资料没有变化。身份不确定时，需要核实正确合作项或实际授权信息，不能只点确认来消除警告。')
      }
      const notes = withContractReviewNote(selected.item, evidence, issue.settlement_cycle)
      // A full-field PUT replaces every access-item column. Read a fresh copy
      // and abort if another editor has updated it since this dialog opened.
      const latestResponse = await listContracts({ q: partnerName, limit: 100, offset: 0 })
      let latest = findEntry(latestResponse.items, selected.contract.id, selected.item.id)
      if (!latest) {
        const fallback = await listContracts({ q: selected.contract.contract_name, limit: 100, offset: 0 })
        latest = findEntry(fallback.items, selected.contract.id, selected.item.id)
      }
      if (!latest) throw new Error('合作项已从合同库移除或不再可见，不能覆盖，请重新打开核对窗口')
      if (String(latest.item.updated_at || '') !== String(selected.item.updated_at || '')) {
        throw new Error('其他人已经更新这条合同合作项。请关闭窗口重新打开，确认最新内容后再保存')
      }
      const next = fullContractAccessUpdate(latest.item, { ...changes, remarks: notes })
      const text = [
        '即将更新合同库中现有的游戏合作项（不创建新合同）。',
        '账单游戏：' + issue.game_name,
        '合同游戏：' + latest.item.product_name + ' → ' + next.product_name,
        '授权日期：' + (next.authorization_start || '未注明') + ' 至 ' + (next.authorization_end || '未注明'),
        '合同分成/通道费：' + (next.share_rate ?? '未填') + '% / ' + (next.channel_fee_rate ?? '未填') + '%（不修改）',
        '这一更新可能影响使用该合同的其他账单。保存后当前账单重新匹配，流水及平台实结保持不变。',
        '',
        '确认已核实这些资料吗？'
      ].join('\n')
      if (!window.confirm(text)) return
      await updateContractAccessItem(String(selected.contract.id), String(selected.item.id), next)
      await onSaved?.()
      onClose?.()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '合同更新失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="channel-contract-inline-mask" onMouseDown={() => { if (!saving) onClose?.() }}>
      <section className="channel-contract-inline" role="dialog" aria-modal="true" aria-label="本页核对合同" onMouseDown={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === 'Enter') event.preventDefault() }}>
        <header>
          <div>
            <small>CONTRACT VERIFICATION</small>
            <h3>本页核对合同</h3>
            <p>第 {Number(issue.line_index) + 1} 行 · {issue.game_name} · {issue.settlement_cycle}</p>
          </div>
          <button type="button" onClick={onClose} disabled={saving} aria-label="关闭合同核对">×</button>
        </header>
        <div className="channel-contract-inline__body">
          <div className="channel-contract-inline__tip">
            当前提示不仅涉及授权日期，还涉及合同候选身份。请对照真实合同核实，不要为通过校验而虚填日期或修改游戏版本。
          </div>
          {loading ? <p role="status">正在读取合同合作项…</p> : null}
          {selected && !loading ? (
            <>
              <div className="channel-contract-inline__grid">
                <label className="is-wide"><span>候选合同与合作游戏</span>
                  <select value={selectedKey} disabled={saving} onChange={(e) => pickChoice(e.target.value)}>
                    {choices.map(({contract,item}) => <option key={candidateKey(contract,item)} value={candidateKey(contract,item)}>
                      {(contract.contract_no || contract.contract_name || '未编号合同') + ' · ' + item.product_name}
                    </option>)}
                  </select>
                </label>
                <label className="is-wide"><span>合同游戏名称（核对后可修正）</span>
                  <input value={fields.product_name} disabled={saving} onChange={(e) => setFields(v => ({ ...v, product_name: e.target.value }))} aria-label="合同游戏名称" />
                </label>
                <label className="is-wide"><span>合同对应渠道（以合同原文为准）</span>
                  <input value={fields.channel_name} disabled={saving} onChange={(e) => setFields(v => ({ ...v, channel_name: e.target.value }))} aria-label="合同对应渠道" placeholder="合同未注明时可留空" />
                </label>
                <label><span>授权开始</span><input type="date" value={fields.authorization_start} disabled={saving} aria-label="授权开始" onChange={(e) => setFields(v => ({ ...v, authorization_start: e.target.value }))} /></label>
                <label><span>授权结束</span><input type="date" value={fields.authorization_end} disabled={saving} aria-label="授权结束" onChange={(e) => setFields(v => ({ ...v, authorization_end: e.target.value }))} /></label>
              </div>
              <div className="channel-contract-inline__readonly">
                <span>当前合同分成 <strong>{selected.item.share_rate == null ? '未填' : selected.item.share_rate + '%'}</strong></span>
                <span>合同通道费 <strong>{selected.item.channel_fee_rate == null ? '未填' : selected.item.channel_fee_rate + '%'}</strong></span>
                <span>原授权期 <strong>{selected.item.authorization_start || '未注明'} 至 {selected.item.authorization_end || '未注明'}</strong></span>
              </div>
              <label className="channel-contract-inline__reason"><span>合同核对依据（必填，将追加到合作项备注）</span>
                <textarea rows={2} value={evidence} disabled={saving} onChange={e => setEvidence(e.target.value)} placeholder="例如：已核对签署合同与2025年7月该游戏合作范围" aria-label="合同核对依据" />
              </label>
              <label className="channel-contract-inline__checkbox">
                <input type="checkbox" checked={verified} disabled={saving} onChange={e => setVerified(e.target.checked)} />
                我已核对合同原件，确认这款游戏、合同及授权信息真实准确
              </label>
              <p className="channel-contract-inline__disclaimer">修改的是合同库中的合作项，不是当前账单金额。保存后会重新匹配合同；如仍存在其他有效候选或费率差异，系统会继续提示人工核对。</p>
            </>
          ) : null}
          {error ? <div role="alert" className="channel-contract-inline__error">{error}</div> : null}
        </div>
        <footer>
          <button type="button" disabled={saving} onClick={onClose}>取消</button>
          <button type="button" className="is-primary" disabled={!selected || loading || saving || !verified || evidence.trim().length < 6} onClick={() => void save()}>
            {saving ? '正在保存…' : '保存合同信息并重新匹配'}
          </button>
        </footer>
      </section>
    </div>
  )
}
