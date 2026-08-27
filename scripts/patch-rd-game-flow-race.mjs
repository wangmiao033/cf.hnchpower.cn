import fs from 'node:fs'

const target = 'src/components/reconciliation/ReconciliationLineItemsForm.jsx'
let source = fs.readFileSync(target, 'utf8')
let changes = 0

function replaceOnce(before, after, label) {
  if (source.includes(after)) return
  const first = source.indexOf(before)
  const last = source.lastIndexOf(before)
  if (first < 0) {
    throw new Error(`RD game-flow hotfix: missing source marker: ${label}`)
  }
  if (first !== last) {
    throw new Error(`RD game-flow hotfix: source marker is not unique: ${label}`)
  }
  source = source.replace(before, after)
  changes += 1
}

replaceOnce(
  "  const gameSearchTimersRef = useRef({})\n",
  "  const gameSearchTimersRef = useRef({})\n  const gameFlowRequestVersionsRef = useRef({})\n",
  'request version ref'
)

replaceOnce(
  "  const syncGameFlow = async (index, rawName, cycleOverride = '') => {\n    const line = lines[index]\n    if (!line) return\n    const lineId = line.id\n    const gameName = String(rawName || '').trim()\n",
  "  const syncGameFlow = async (index, rawName, cycleOverride = '') => {\n    const line = lines[index]\n    if (!line) return\n    const lineId = line.id\n    const requestVersion = (gameFlowRequestVersionsRef.current[lineId] || 0) + 1\n    gameFlowRequestVersionsRef.current[lineId] = requestVersion\n    const isCurrentRequest = () => gameFlowRequestVersionsRef.current[lineId] === requestVersion\n    const gameName = String(rawName || '').trim()\n",
  'sync request version'
)

replaceOnce(
  "      const result = await getQuickSdkGameFlow({\n        settlement_month: month,\n        game_name: gameName\n      })\n      const totalFlow = Number(result?.total_flow || 0)\n",
  "      const result = await getQuickSdkGameFlow({\n        settlement_month: month,\n        game_name: gameName\n      })\n      if (!isCurrentRequest()) return\n      const totalFlow = Number(result?.total_flow || 0)\n",
  'discard stale response'
)

replaceOnce(
  "          rowIndex === index\n            ? {\n                ...row,\n                gameName: result.game_name || gameName,\n                revenue: flowInputValue(totalFlow),\n",
  "          rowIndex === index &&\n          row.id === lineId &&\n          String(row.gameName || '').trim() === gameName\n            ? {\n                ...row,\n                revenue: flowInputValue(totalFlow),\n",
  'preserve typed game name'
)

replaceOnce(
  "      const preset = findGamePreset(result.game_name || gameName)\n",
  "      const preset = findGamePreset(gameName)\n",
  'preset follows typed name'
)

replaceOnce(
  "    } catch (error) {\n      setFlowStatus(lineId, {\n",
  "    } catch (error) {\n      if (!isCurrentRequest()) return\n      setFlowStatus(lineId, {\n",
  'ignore stale error status'
)

replaceOnce(
  "                          onChange={(e) => {\n                            updateLine(index, 'gameName', e.target.value)\n",
  "                          onChange={(e) => {\n                            gameFlowRequestVersionsRef.current[line.id] =\n                              (gameFlowRequestVersionsRef.current[line.id] || 0) + 1\n                            updateLine(index, 'gameName', e.target.value)\n",
  'invalidate lookup while typing'
)

replaceOnce(
  "                        onChange={(e) => {\n                          updateLine(index, 'revenue', e.target.value)\n",
  "                        onChange={(e) => {\n                          gameFlowRequestVersionsRef.current[line.id] =\n                            (gameFlowRequestVersionsRef.current[line.id] || 0) + 1\n                          updateLine(index, 'revenue', e.target.value)\n",
  'protect manual revenue edits'
)

const requiredMarkers = [
  'const gameFlowRequestVersionsRef = useRef({})',
  'const isCurrentRequest = () => gameFlowRequestVersionsRef.current[lineId] === requestVersion',
  "String(row.gameName || '').trim() === gameName",
  'const preset = findGamePreset(gameName)'
]
for (const marker of requiredMarkers) {
  if (!source.includes(marker)) {
    throw new Error(`RD game-flow hotfix failed verification: ${marker}`)
  }
}

if (changes > 0) {
  fs.writeFileSync(target, source)
  console.log(`Applied RD game-flow race hotfix (${changes} changes).`)
} else {
  console.log('RD game-flow race hotfix already applied.')
}
