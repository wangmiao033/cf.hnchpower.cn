import fs from 'node:fs'

function patchFile(target, patches, requiredMarkers, label) {
  let source = fs.readFileSync(target, 'utf8')
  let changes = 0

  for (const patch of patches) {
    const { before, after, name } = patch
    if (source.includes(after)) continue
    const first = source.indexOf(before)
    const last = source.lastIndexOf(before)
    if (first < 0) throw new Error(`${label}: missing source marker: ${name}`)
    if (first !== last) throw new Error(`${label}: source marker is not unique: ${name}`)
    source = source.replace(before, after)
    changes += 1
  }

  for (const marker of requiredMarkers) {
    if (!source.includes(marker)) throw new Error(`${label} failed verification: ${marker}`)
  }

  if (changes > 0) {
    fs.writeFileSync(target, source)
    console.log(`Applied ${label} (${changes} changes).`)
  } else {
    console.log(`${label} already applied.`)
  }
}

patchFile(
  'src/components/reconciliation/RdContractSmartEntry.jsx',
  [
    {
      name: 'identity api client',
      before: "import { upsertContractAccessTerms } from '@/lib/api/contractTerms.ts'\n",
      after: "import { upsertContractAccessTerms } from '@/lib/api/contractTerms.ts'\nimport { apiPost } from '@/lib/api/client.ts'\n"
    },
    {
      name: 'identity api helpers',
      before: "function nullableNumber(value) {\n  const raw = text(value).replace('%', '')\n  if (!raw) return null\n  const parsed = Number(raw)\n  return Number.isFinite(parsed) ? parsed : null\n}\n\nexport default function RdContractSmartEntry({\n",
      after: "function nullableNumber(value) {\n  const raw = text(value).replace('%', '')\n  if (!raw) return null\n  const parsed = Number(raw)\n  return Number.isFinite(parsed) ? parsed : null\n}\n\nfunction resolveGameIdentities(payload) {\n  return apiPost('/api/contract-terms/game-identities/resolve', payload)\n}\n\nfunction saveGameIdentityAlias(payload) {\n  return apiPost('/api/contract-terms/game-identities/alias', payload)\n}\n\nexport default function RdContractSmartEntry({\n"
    },
    {
      name: 'identity ui state',
      before: "  const [mapOpen, setMapOpen] = useState(false)\n  const [mapGame, setMapGame] = useState('')\n  const [mapAccessId, setMapAccessId] = useState('')\n",
      after: "  const [mapOpen, setMapOpen] = useState(false)\n  const [mapGame, setMapGame] = useState('')\n  const [mapAccessId, setMapAccessId] = useState('')\n  const [mapSaving, setMapSaving] = useState(false)\n  const [identityRevision, setIdentityRevision] = useState(0)\n  const [identityState, setIdentityState] = useState({ items: [], accessItems: [], loading: false })\n"
    },
    {
      name: 'persistent identity matching',
      before: "  const lineMatches = useMemo(() => lines.map((line) => {\n    const exact = contractGames.filter(({ accessItem }) => gameKey(accessItem.product_name) === gameKey(line.gameName))\n    if (exact.length === 1) return { line, pair: exact[0], mode: 'exact' }\n    if (exact.length > 1) return { line, pair: exact[0], mode: 'multiple' }\n    const base = contractGames.filter(({ accessItem }) => baseGameKey(accessItem.product_name) === baseGameKey(line.gameName))\n    if (base.length === 1) return { line, pair: base[0], mode: 'base' }\n    return { line, pair: null, mode: base.length > 1 ? 'ambiguous' : 'none' }\n  }), [contractGames, lines])\n\n  const missingGames = lineMatches.filter((item) => !item.pair).map((item) => text(item.line.gameName))\n  const matchedCount = lineMatches.filter((item) => item.pair).length\n",
      after: "  const identityLookupKey = JSON.stringify({\n    names: [...new Set(lines.map((line) => text(line.gameName)).filter(Boolean))].sort(),\n    access_item_ids: [...new Set(contractGames.map(({ accessItem }) => String(accessItem.id || '')).filter(Boolean))].sort()\n  })\n\n  useEffect(() => {\n    const lookup = JSON.parse(identityLookupKey)\n    if (!lookup.names.length && !lookup.access_item_ids.length) {\n      setIdentityState({ items: [], accessItems: [], loading: false })\n      return undefined\n    }\n    let cancelled = false\n    setIdentityState((current) => ({ ...current, loading: true }))\n    void resolveGameIdentities(lookup)\n      .then((result) => {\n        if (cancelled) return\n        setIdentityState({\n          items: Array.isArray(result?.items) ? result.items : [],\n          accessItems: Array.isArray(result?.access_items) ? result.access_items : [],\n          loading: false\n        })\n      })\n      .catch(() => {\n        if (!cancelled) setIdentityState((current) => ({ ...current, loading: false }))\n      })\n    return () => { cancelled = true }\n  }, [identityLookupKey, identityRevision])\n\n  const nameIdentityMap = useMemo(() => Object.fromEntries(\n    (identityState.items || []).map((item) => [text(item.input_name), item])\n  ), [identityState.items])\n  const accessIdentityMap = useMemo(() => Object.fromEntries(\n    (identityState.accessItems || []).map((item) => [String(item.access_item_id || ''), item])\n  ), [identityState.accessItems])\n\n  const lineMatches = useMemo(() => lines.map((line) => {\n    const exact = contractGames.filter(({ accessItem }) => gameKey(accessItem.product_name) === gameKey(line.gameName))\n    if (exact.length === 1) return { line, pair: exact[0], mode: 'exact' }\n    if (exact.length > 1) return { line, pair: exact[0], mode: 'multiple' }\n\n    const identity = nameIdentityMap[text(line.gameName)]\n    if (identity?.game_id) {\n      const mapped = contractGames.filter(({ accessItem }) => (\n        accessIdentityMap[String(accessItem.id || '')]?.game_id === identity.game_id\n      ))\n      if (mapped.length) return { line, pair: mapped[0], mode: 'identity', identity }\n    }\n\n    const base = contractGames.filter(({ accessItem }) => baseGameKey(accessItem.product_name) === baseGameKey(line.gameName))\n    if (base.length === 1) return { line, pair: base[0], mode: 'base' }\n    return { line, pair: null, mode: base.length > 1 ? 'ambiguous' : 'none' }\n  }), [accessIdentityMap, contractGames, lines, nameIdentityMap])\n\n  const missingGames = lineMatches.filter((item) => !item.pair).map((item) => text(item.line.gameName))\n  const matchedCount = lineMatches.filter((item) => item.pair).length\n  const mappedCount = lineMatches.filter((item) => item.mode === 'identity').length\n"
    },
    {
      name: 'save alias instead of renaming bill',
      before: "  const applyMap = () => {\n    const pair = contractGames.find(({ accessItem }) => String(accessItem.id) === String(mapAccessId))\n    if (!pair || !mapGame) return\n    const currentItems = Array.isArray(record?.items) ? record.items : []\n    const nextItems = currentItems.map((line) => (\n      text(line?.gameName) === mapGame\n        ? { ...line, gameName: text(pair.accessItem.product_name) }\n        : line\n    ))\n    setMapOpen(false)\n    onApply?.(\n      { ...(record || {}), items: nextItems },\n      `已按研发合同标准游戏名匹配：${mapGame} → ${pair.accessItem.product_name}`,\n      'success'\n    )\n  }\n",
      after: "  const applyMap = async () => {\n    const pair = contractGames.find(({ accessItem }) => String(accessItem.id) === String(mapAccessId))\n    if (!pair || !mapGame || mapSaving) return\n    setMapSaving(true)\n    try {\n      const result = await saveGameIdentityAlias({\n        alias_name: mapGame,\n        access_item_id: String(pair.accessItem.id)\n      })\n      setMapOpen(false)\n      setIdentityRevision((value) => value + 1)\n      onSourceChanged?.()\n      onNotice?.(\n        result?.message || `已记住：${mapGame} → ${pair.accessItem.product_name}，以后自动识别。`,\n        'success'\n      )\n    } catch (error) {\n      onNotice?.(error instanceof Error ? error.message : '保存游戏名称映射失败', 'error')\n    } finally {\n      setMapSaving(false)\n    }\n  }\n"
    },
    {
      name: 'mapped count status',
      before: "                ? `${matchedCount}/${lines.length} 个账单游戏已在合同合作清单中定位${targetMonth ? ` · ${monthLabel(targetMonth)}` : ''}`\n",
      after: "                ? `${matchedCount}/${lines.length} 个账单游戏已在合同合作清单中定位${mappedCount ? ` · ${mappedCount} 个通过名称映射识别` : ''}${targetMonth ? ` · ${monthLabel(targetMonth)}` : ''}`\n"
    },
    {
      name: 'mapping issue copy',
      before: "            <strong>发现 {missingGames.length} 个游戏还没在研发合同中定位</strong>\n            <span>先处理合同来源，再让下方合同规则进行金额核验。</span>\n",
      after: "            <strong>发现 {missingGames.length} 个游戏名称尚未建立映射</strong>\n            <span>只需确认一次对应的合同游戏；以后相同名称会自动识别，不再改写账单名称。</span>\n"
    },
    {
      name: 'mapping action label',
      before: "                  <button type=\"button\" disabled={!contractGames.length} onClick={() => openMap(gameName)}>按合同名称匹配</button>\n",
      after: "                  <button type=\"button\" disabled={!contractGames.length} onClick={() => openMap(gameName)}>建立名称映射</button>\n"
    },
    {
      name: 'mapping dialog copy',
      before: "          <div className=\"channel-smart-entry__dialog channel-smart-entry__dialog--compact\" role=\"dialog\" aria-modal=\"true\" aria-label=\"研发合同游戏名称匹配\" onMouseDown={(event) => event.stopPropagation()}>\n            <header>\n              <div><span>CONTRACT GAME MAP</span><h3>按研发合同标准名匹配</h3><p>只修改当前账单的游戏名称，不改后台流水。</p></div>\n              <button type=\"button\" onClick={() => setMapOpen(false)}>×</button>\n            </header>\n            <div className=\"channel-smart-entry__dialog-grid\">\n              <label className=\"is-wide\"><span>账单游戏</span><input value={mapGame} disabled /></label>\n              <label className=\"is-wide\"><span>研发合同合作游戏</span><select value={mapAccessId} onChange={(event) => setMapAccessId(event.target.value)}>{contractGames.map(({ contract, accessItem }) => <option key={accessItem.id} value={accessItem.id}>{accessItem.product_name} · {contractLabel(contract)}</option>)}</select></label>\n            </div>\n            <footer><span>匹配后，下方会立即重新按该合同游戏进行规则核验。</span><div><button type=\"button\" onClick={() => setMapOpen(false)}>取消</button><button type=\"button\" className=\"is-primary\" disabled={!mapAccessId} onClick={applyMap}>应用合同名称</button></div></footer>\n          </div>\n",
      after: "          <div className=\"channel-smart-entry__dialog channel-smart-entry__dialog--compact\" role=\"dialog\" aria-modal=\"true\" aria-label=\"研发游戏名称映射\" onMouseDown={(event) => event.stopPropagation()}>\n            <header>\n              <div><span>GAME IDENTITY MAP</span><h3>映射到标准游戏</h3><p>只建立游戏身份映射，不修改当前账单名称，也不改后台流水。</p></div>\n              <button type=\"button\" disabled={mapSaving} onClick={() => setMapOpen(false)}>×</button>\n            </header>\n            <div className=\"channel-smart-entry__dialog-grid\">\n              <label className=\"is-wide\"><span>当前账单名称</span><input value={mapGame} disabled /></label>\n              <label className=\"is-wide\"><span>映射到合同游戏</span><select value={mapAccessId} disabled={mapSaving} onChange={(event) => setMapAccessId(event.target.value)}>{contractGames.map(({ contract, accessItem }) => <option key={accessItem.id} value={accessItem.id}>{accessItem.product_name} · {contractLabel(contract)}</option>)}</select></label>\n            </div>\n            <footer><span>保存一次后，后续账单遇到相同名称会自动识别；原账单名称保持不变。</span><div><button type=\"button\" disabled={mapSaving} onClick={() => setMapOpen(false)}>取消</button><button type=\"button\" className=\"is-primary\" disabled={mapSaving || !mapAccessId} onClick={() => void applyMap()}>{mapSaving ? '正在保存…' : '保存映射'}</button></div></footer>\n          </div>\n"
    }
  ],
  [
    "apiPost('/api/contract-terms/game-identities/resolve'",
    'identityRevision',
    "mode: 'identity'",
    'saveGameIdentityAlias',
    '只建立游戏身份映射，不修改当前账单名称',
    '保存映射'
  ],
  'RD persistent game-alias mapping'
)
