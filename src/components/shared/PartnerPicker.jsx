import React, { useMemo, useRef, useState } from 'react'

export function partnerKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[（(]/g, '(')
    .replace(/[）)]/g, ')')
    .replace(/\s+/g, '')
}

export function findExactPartner(partners, value) {
  const key = partnerKey(value)
  if (!key) return null
  const matches = (partners || []).filter(
    (partner) =>
      partner?.name &&
      [partner.name, partner.shortName].some((candidate) => partnerKey(candidate) === key)
  )
  const unique = new Map(matches.map((partner) => [String(partner.id || partner.name), partner]))
  return unique.size === 1 ? [...unique.values()][0] : null
}

function PartnerPicker({
  value,
  partnerId,
  partners,
  onChange,
  onAddPartner,
  required = false,
  linkedText = '已关联客户库，客户资料更新后账单仍保持关联',
  unlinkedText = '请从客户库结果中选择合作方'
}) {
  const inputRef = useRef(null)
  const [open, setOpen] = useState(false)
  const query = String(value || '').trim().toLowerCase()
  const matches = useMemo(() => {
    const source = (partners || []).filter((partner) => partner?.name)
    if (!query) return source.slice(0, 8)
    return source
      .filter((partner) =>
        [
          partner.shortName,
          partner.name,
          partner.category,
          partner.taxRegistrationNo,
          partner.tag2
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(query)
      )
      .slice(0, 8)
  }, [partners, query])
  const exactMatch = findExactPartner(partners, value)

  const selectPartner = (partner) => {
    onChange(partner.name, String(partner.id || ''), partner)
    setOpen(false)
  }

  const addPartner = () => {
    const name = String(value || '').trim()
    if (!name) {
      inputRef.current?.focus()
      setOpen(true)
      return
    }
    onAddPartner?.(name)
    setOpen(false)
  }

  return (
    <div className="rd-partner-picker">
      <div className="rd-partner-picker__control">
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-label="搜索客户库合作方"
          aria-expanded={open}
          aria-autocomplete="list"
          className="admin-input"
          value={value}
          required={required}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onChange={(event) => {
            const nextValue = event.target.value
            const matched = findExactPartner(partners, nextValue)
            onChange(nextValue, matched ? String(matched.id || '') : '', matched)
            setOpen(true)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setOpen(false)
            if (event.key === 'Enter' && open && matches.length === 1) {
              event.preventDefault()
              selectPartner(matches[0])
            }
          }}
          placeholder="搜索简称或公司全称"
        />
        <button
          type="button"
          className="rd-partner-picker__add"
          onClick={addPartner}
          title={value && !exactMatch ? '新增到客户库' : '输入新的合作方名称'}
          aria-label="新增合作方"
        >
          +
        </button>
      </div>
      <div
        className={`rd-partner-picker__link-state ${
          partnerId ? 'rd-partner-picker__link-state--linked' : ''
        }`}
      >
        {partnerId ? linkedText : unlinkedText}
      </div>
      {open ? (
        <div className="rd-partner-picker__menu" role="listbox" aria-label="客户库合作方">
          <div className="rd-partner-picker__menu-head">
            <strong>客户库</strong>
            <span>{(partners || []).length} 个合作方</span>
          </div>
          {matches.map((partner) => (
            <button
              key={partner.id || partner.name}
              type="button"
              role="option"
              aria-selected={String(partner.id || '') === String(partnerId || '')}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectPartner(partner)}
            >
              <span>
                <strong>{partner.shortName || partner.name}</strong>
                <small>{partner.shortName ? partner.name : partner.category || '未分类'}</small>
              </span>
              <em>{partner.category || partner.taxRegistrationNo || partner.tag2 || ''}</em>
            </button>
          ))}
          {matches.length === 0 ? (
            <div className="rd-partner-picker__empty">客户库中没有匹配的合作方</div>
          ) : null}
          {String(value || '').trim() && !exactMatch ? (
            <button
              type="button"
              className="rd-partner-picker__create"
              onMouseDown={(event) => event.preventDefault()}
              onClick={addPartner}
            >
              <span>+</span>
              将“{String(value || '').trim()}”新增到客户库
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export default PartnerPicker
