/**
 * Print a described tinker value as text. The first, plain rendering of a
 * result: the expandable cards replace it, and it stays as the copy-as-text form.
 */

interface Described { t: string, [key: string]: unknown }

export function renderTinkerValue(value: Described, indent = ''): string {
  const inner = `${indent}  `
  const list = (items: string[], more: unknown): string[] => more ? [...items, `${inner}... ${more} more`] : items
  switch (value.t) {
    case 'undefined': return 'undefined'
    case 'null': return 'null'
    case 'boolean':
    case 'number': return String(value.v)
    case 'bigint': return `${value.v}n`
    case 'string': return JSON.stringify(value.v) + (value.truncated ? ` ... ${value.truncated} more characters` : '')
    case 'symbol': return `Symbol(${value.v})`
    case 'function': return `[${value.kind === 'class' ? 'class' : 'Function'}: ${value.name}]`
    case 'date': return String(value.v ?? 'Invalid Date')
    case 'regexp':
    case 'url': return String(value.v)
    case 'promise': return 'Promise {}'
    case 'bytes': return `${value.ctor}(${value.length}) <${value.hex}>`
    case 'ref': return `[Circular *${value.id}]`
    case 'cut': return `[${value.ctor ?? 'Object'}]`
    case 'error': return String(value.stack ?? `${value.name}: ${value.message}`)
    case 'array':
    case 'set': {
      const items = (value.items as Described[]).map(item => `${inner}${renderTinkerValue(item, inner)}`)
      const name = value.t === 'set' ? `Set(${value.size}) ` : value.ctor ? `${value.ctor} ` : ''
      const [open, close] = value.t === 'set' ? ['{', '}'] : ['[', ']']
      return items.length || value.more ? `${name}${open}\n${list(items, value.more).join(',\n')}\n${indent}${close}` : `${name}${open}${close}`
    }
    case 'map': {
      const entries = (value.entries as Array<[Described, Described]>).map(([key, item]) => `${inner}${renderTinkerValue(key, inner)} => ${renderTinkerValue(item, inner)}`)
      return entries.length ? `Map(${value.size}) {\n${list(entries, value.more).join(',\n')}\n${indent}}` : 'Map(0) {}'
    }
    case 'html': return `[${value.kind}${value.title ? ` ${value.title}` : ''}: ${String(value.html).length} characters of markup]`
    case 'model': {
      const entries = (value.attributes as Array<[string, Described]>).map(([key, item]) => `${inner}${key}: ${renderTinkerValue(item, inner)}`)
      for (const name of (value.hidden as string[] | undefined) ?? [])
        entries.push(`${inner}${name}: [hidden]`)
      for (const [name, item] of (value.loaded as Array<[string, Described]> | undefined) ?? [])
        entries.push(`${inner}${name}: ${renderTinkerValue(item, inner)}`)
      return `${value.model} {\n${list(entries, value.more).join(',\n')}\n${indent}}`
    }
    case 'object': {
      const entries = (value.entries as Array<[string, Described]>).map(([key, item]) => `${inner}${key}: ${renderTinkerValue(item, inner)}`)
      const name = value.ctor ? `${value.ctor} ` : ''
      return entries.length || value.more ? `${name}{\n${list(entries, value.more).join(',\n')}\n${indent}}` : `${name}{}`
    }
    default: return String(value.t)
  }
}
