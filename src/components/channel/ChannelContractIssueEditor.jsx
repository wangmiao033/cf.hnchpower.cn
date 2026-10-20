import React, { useEffect, useMemo, useState } from 'react'
import { listAllContracts, listContracts, updateContractAccessItem } from '@/lib/api/contract.ts'
import { normalizeInlineKey } from '@/domain/channel/channelInlineResolution.js'
import {
  accessDataModified,
  candidateKey,
  checkContractAuthorizationForMonth,
  fullContractAccessUpdate,
  contractAccessMatchesLine,
  withContractReviewNote
} from '@/domain/channel/channelContractInlineReview.js'
import './ChannelContractIssueEditor.css'

const normalize = (value) => normalizeInlineKey(value).replace(/[()（）\s]/g, '')
const safeText = (value) => String(value ?? '').trim()
const matchedPartner = (contract, partnerName, partnerId = '') => {
  // A linked legal entity is authoritative. Never expose or apply another
  // customer's contract merely because two display names look similar.
  if (partnerId && contract.partner_id && String(contract.partner_id) !== String(partnerId)) return false
  if (partnerId && String(contract.partner_id || '') === String(partnerId)) return true
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

export function availableChoices(rows, issue, partnerName, partnerId) {
  const match = issue?.match || {}
  const baseGame = normalize(safeText(issue?.game_name).split(/[（(]/)[0])
  const all = (rows || []).flatMap(contract => (contract.access_items || []).map(item => ({ contract, item })))
  const similar = all.filter(({contract,item}) => {
    if (!matchedPartner(contract, partnerName, partnerId)) return false
    if (contractAccessMatchesLine(issue.game_name, item)) return true
    const game = normalize(item.product_name)
    return Boolean(baseGame && game && (game.includes(baseGame) || baseGame.includes(game)))
  })
  const matched = findEntry(rows, match.contract_id, match.access_item_id)
  if (matched && matchedPartner(matched.contract, partnerName, partnerId) &&
      !similar.some(x => candidateKey(x.contract,x.item) === candidateKey(matched.contract,matched.item))) similar.unshift(matched)
  return similar
}

export default function ChannelContractIssueEditor({ issue, partnerName, partnerId = '', onClose, onSaved, onUseExisting }) {
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
      // Search terms can differ from the linked legal company name. If the
      // customer ID is known but the narrow search did not return its contract,
      // fall back to the contract ledger without losing the current bill draft.
      if (partnerId && !rows.some(record => String(record.partner_id || '') === String(partnerId))) {
        const full = await listAllContracts()
        rows = [...rows, ...full.items.filter(record => !rows.some(existing => String(existing.id) === String(record.id)))]
      }
      let matched = findEntry(rows, issue.match?.contract_id, issue.match?.access_item_id)
      if (!matched && issue.match?.contract_name) {
        const second = await listContracts({ q: issue.match.contract_name, limit: 100, offset: 0 })
        rows = [...rows, ...(second.items || []).filter(x => !rows.some(existing => String(existing.id) === String(x.id)))]
      }
      const available = availableChoices(rows, issue, partnerName, partnerId)
      if (!active) return
      if (!available.length) {
        setError('当前客户的已有合同没有可选的同名游戏清单。请核对合作游戏名称；当前账单内容未改变。')
        return
      }
      const current = available.find(({ contract,item }) => (
        String(contract.id) === String(issue.match?.contract_id) && String(item.id) === String(issue.match?.access_item_id)
      )) || available.find(({ item }) => contractAccessMatchesLine(issue.game_name, item)) || available[0]
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
  }, [issue, partnerName, partnerId])

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

  const useExisting = async () => {
    if (!selected || saving || !onUseExisting) return
    setError('')
    setSaving(true)
    try {
      if (!contractAccessMatchesLine(issue.game_name, selected.item)) {
        throw new Error('当前账单游戏与所选合同游戏不是同一个商业版本（折扣/红包版等必须相同），不能直接套用。请选正确的已有清单。')
      }
      checkContractAuthorizationForMonth(
        issue.settlement_cycle, selected.item.authorization_start, selected.item.authorization_end
      )
      if (selected.item.share_rate == null || selected.item.channel_fee_rate == null) {
        throw new Error('所选合作清单的分成或通道费未填写，不能套用默认财务规则。')
      }
      // The server recomputes and validates this existing access-item ID
      // against the linked customer, channel, SKU, active month and conflicts.
      // Neither the contract nor any historical bill is changed here.
      await onUseExisting({ contract: selected.contract, item: selected.item })
      onClose?.()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '核对已有合作清单失败')
    } finally {
      setSaving(false)
    }
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
              {!issue.match ? (
                <div className="channel-contract-inline__tip">
                  已找到当前客户录入过的合作游戏清单。请选择同一折扣和商业版本，点击“使用已有清单重新匹配”即可；
                  不需要再次录入或修改原合同。只有真实合同信息有误时才使用下方修改功能。
                </div>
              ) : null}
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
              {!contractAccessMatchesLine(issue.game_name, selected.item) ? (
                <div role="status" className="channel-contract-inline__error">
                  当前选择的合作游戏“{selected.item.product_name}”与账单游戏“{issue.game_name}”商业版本或明确设备信息不兼容，不能自动带入。
                </div>
              ) : null}
              <div className="channel-contract-inline__readonly">
                <span>合同设备平台 <strong>{selected.item.platform || '未注明'}</strong></span>
                <span>合同渠道 <strong>{selected.item.channel_name || '未注明'}</strong></span>
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
          {onUseExisting ? (
            <button type="button" className="is-primary" disabled={!selected || loading || saving || !contractAccessMatchesLine(issue.game_name, selected.item)} onClick={() => void useExisting()}>
              {saving ? '正在核对…' : '使用已有清单重新匹配本行'}
            </button>
          ) : null}
          <button type="button" disabled={!selected || loading || saving || !verified || evidence.trim().length < 6} onClick={() => void save()}>
            {saving ? '正在保存…' : issue.match ? '保存合同信息并重新匹配' : '确需修改原合同信息'}
          </button>
        </footer>
      </section>
    </div>
  )
}
