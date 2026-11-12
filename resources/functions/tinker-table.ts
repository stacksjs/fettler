/**
 * Table mode: a result that is a list of records, read as rows and columns.
 *
 * Works on the described value a session sends, so it is the same for models,
 * plain objects and query rows. A value that is not a list of records has no
 * table and the caller shows it as text.
 */

interface Described { t: string, [key: string]: unknown }

export interface ResultTable {
  columns: string[]
  /** One array per row, a display string per column. Empty string where a row has no such field. */
  rows: string[][]
  /** Rows the value holds beyond the ones listed, when the session cut the list. */
  more: number
}

const MAX_COLUMNS = 60

/** A cell as text: scalars as themselves, anything nested as a short summary. */
export function cellText(value: Described | undefined): string {
  if (!value)
    return ''
  switch (value.t) {
    case 'string':
    case 'number':
    case 'boolean':
    case 'bigint':
    case 'url':
    case 'regexp':
      return String(value.v)
    case 'null': return 'null'
    case 'undefined': return ''
    case 'date': return String(value.v ?? '')
    case 'array': return `[${value.length} items]`
    case 'set': return `Set(${value.size})`
    case 'map': return `Map(${value.size})`
    case 'model': return `${value.model}${(value.key as Described | undefined) ? ` #${cellText(value.key as Described)}` : ''}`
    case 'object': return `{${(value.entries as unknown[]).length} fields}`
    case 'error': return `${value.name}: ${value.message}`
    default: return `[${value.t}]`
  }
}

function fieldsOf(item: Described): Array<[string, Described]> | undefined {
  if (item.t === 'model')
    return item.attributes as Array<[string, Described]>
  if (item.t === 'object')
    return item.entries as Array<[string, Described]>
  return undefined
}

/** The table a described value makes, or null when it is not a list of records. */
export function tableOf(value: Described | null | undefined): ResultTable | null {
  if (!value || (value.t !== 'array' && value.t !== 'set'))
    return null
  const items = value.items as Described[]
  if (!items.length)
    return null
  const records = items.map(fieldsOf)
  if (records.some(record => !record))
    return null

  const columns: string[] = []
  const seen = new Set<string>()
  for (const record of records) {
    for (const [key] of record!) {
      if (!seen.has(key) && columns.length < MAX_COLUMNS) {
        seen.add(key)
        columns.push(key)
      }
    }
  }
  const rows = records.map((record) => {
    const byKey = new Map(record!)
    return columns.map(column => cellText(byKey.get(column)))
  })
  return { columns, rows, more: Number(value.more ?? 0) }
}

function csvField(text: string): string {
  // A leading =, +, - or @ makes a spreadsheet run the cell as a formula.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe
}

export function tableToCsv(table: ResultTable): string {
  return [table.columns, ...table.rows].map(row => row.map(csvField).join(',')).join('\n')
}

export function tableToJson(table: ResultTable): string {
  return JSON.stringify(table.rows.map(row => Object.fromEntries(table.columns.map((column, index) => [column, row[index]]))), null, 2)
}

/** Rows that contain the text in any cell, and sorted by one column when asked. */
export function viewRows(table: ResultTable, query: string, sort: { column: number, descending: boolean } | null): string[][] {
  const needle = query.trim().toLowerCase()
  let rows = needle ? table.rows.filter(row => row.some(cell => cell.toLowerCase().includes(needle))) : table.rows.slice()
  if (sort) {
    const numeric = rows.every(row => row[sort.column] === '' || !Number.isNaN(Number(row[sort.column])))
    rows = rows.sort((left, right) => {
      const a = left[sort.column] ?? ''
      const b = right[sort.column] ?? ''
      const order = numeric ? Number(a) - Number(b) : a.localeCompare(b)
      return sort.descending ? -order : order
    })
  }
  return rows
}

/** A cell as the grid wants it: a scalar as itself so the column sorts by type, anything nested as its summary. */
function cellValue(value: Described | undefined): unknown {
  if (!value || value.t === 'undefined')
    return undefined
  if (value.t === 'null')
    return null
  if (value.t === 'string' || value.t === 'number' || value.t === 'boolean')
    return value.v
  return cellText(value)
}

export interface ResultGrid {
  columns: Array<{ key: string, label: string }>
  rows: Array<Record<string, unknown>>
  more: number
}

/** The same table, as records for a data grid. */
export function gridOf(value: Described | null | undefined): ResultGrid | null {
  const table = tableOf(value)
  if (!table || !value)
    return null
  const rows = (value.items as Described[]).map((item) => {
    const byKey = new Map(fieldsOf(item)!)
    return Object.fromEntries(table.columns.map(column => [column, cellValue(byKey.get(column))]))
  })
  return { columns: table.columns.map(column => ({ key: column, label: column })), rows, more: table.more }
}
