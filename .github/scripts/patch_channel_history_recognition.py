from pathlib import Path

smart = Path('src/components/channel/ChannelSmartEntryBar.jsx')
source = smart.read_text(encoding='utf-8')

old = """  const contractGameKeys = useMemo(() => new Set(contractGames.map((item) => textKey(item.gameName))), [contractGames])
  const missingGames = useMemo(() => namedLines(record)
    .map((item) => String(item.gameName || '').trim())
    .filter((name) => name && !contractGameKeys.has(textKey(resolveGameName(name)))), [record, contractGameKeys, resolveGameName])
"""
new = """  const contractGameKeys = useMemo(() => new Set(contractGames.map((item) => textKey(item.gameName))), [contractGames])
  const historicalGameKeys = useMemo(() => new Set(previousLines
    .map((item) => textKey(resolveGameName(item?.gameName)))
    .filter(Boolean)), [previousLines, resolveGameName])
  const missingGames = useMemo(() => namedLines(record)
    .map((item) => String(item.gameName || '').trim())
    .filter((name) => {
      const key = textKey(resolveGameName(name))
      return name && !contractGameKeys.has(key) && !historicalGameKeys.has(key)
    }), [record, contractGameKeys, historicalGameKeys, resolveGameName])
"""
if old not in source:
    raise SystemExit('missingGames target not found')
source = source.replace(old, new, 1)

old = """  const matchedLineCount = namedLines(record).filter((line) => contractGameFor(line.gameName)).length
  const channelAliasRemembered = channelName && resolveAlias(aliasMemory, 'channel', channelName) !== channelName
"""
new = """  const matchedLineCount = namedLines(record).filter((line) => contractGameFor(line.gameName)).length
  const historicalMatchedLineCount = namedLines(record).filter((line) => {
    const key = textKey(resolveGameName(line.gameName))
    return !contractGameKeys.has(key) && historicalGameKeys.has(key)
  }).length
  const channelAliasRemembered = channelName && resolveAlias(aliasMemory, 'channel', channelName) !== channelName
"""
if old not in source:
    raise SystemExit('matchedLineCount target not found')
source = source.replace(old, new, 1)

old = """            <strong>发现 {missingGames.length} 个游戏缺少合同合作清单</strong>
            <span>补清单、映射名称、挂起待补，都在当前账单完成。</span>
"""
new = """            <strong>发现 {missingGames.length} 个游戏既无合同清单，也无历史账单记录</strong>
            <span>只有真正的新游戏才需要补清单、映射名称或挂起待补。</span>
"""
if old not in source:
    raise SystemExit('missingGames copy target not found')
source = source.replace(old, new, 1)

old = """            <span>{matchedLineCount} 个游戏已匹配合同；规则不对或资料没齐都不用跳页面。</span>
"""
new = """            <span>{matchedLineCount} 个游戏已匹配合同{historicalMatchedLineCount ? ` · ${historicalMatchedLineCount} 个按上月历史识别` : ''}；只有真正新游戏才需要补资料。</span>
"""
if old not in source:
    raise SystemExit('inline tools copy target not found')
source = source.replace(old, new, 1)
smart.write_text(source, encoding='utf-8')

test_file = Path('src/components/channel/channelContractSafety.test.js')
test_source = test_file.read_text(encoding='utf-8')
marker = "  it('labels technical errors separately from business rule gaps', () => {\n"
block = """  it('treats previous-month games as recognized instead of forcing a contract supplement', () => {
    expect(smartEntrySource).toContain('const historicalGameKeys = useMemo')
    expect(smartEntrySource).toContain('!contractGameKeys.has(key) && !historicalGameKeys.has(key)')
    expect(smartEntrySource).toContain('const historicalMatchedLineCount = namedLines(record).filter')
    expect(smartEntrySource).toContain('个按上月历史识别')
    expect(smartEntrySource).toContain('只有真正的新游戏才需要补清单')
  })

"""
if block not in test_source:
    if marker not in test_source:
        raise SystemExit('test insertion marker not found')
    test_source = test_source.replace(marker, block + marker, 1)
test_file.write_text(test_source, encoding='utf-8')

Path('.github/scripts/patch_channel_history_recognition.py').unlink(missing_ok=True)
Path('.github/workflows/oneoff-channel-history-recognition-final.yml').unlink(missing_ok=True)
