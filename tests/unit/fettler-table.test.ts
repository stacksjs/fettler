import { describe, expect, test } from 'bun:test'
import { tableOf, tableToCsv, tableToJson, viewRows } from '../../resources/functions/tinker-table'

const s = (v: string) => ({ t: 'string', v })
const n = (v: number) => ({ t: 'number', v })
const model = (id: number, name: string, extra: Array<[string, any]> = []) => ({ t: 'model', model: 'User', key: n(id), attributes: [['id', n(id)], ['name', s(name)], ...extra] })

describe('table mode', () => {
  test('a list of models is rows and columns, with columns from every row', () => {
    const table = tableOf({ t: 'array', length: 2, items: [model(1, 'Ada'), model(2, 'Bo', [['role', s('admin')]])] })!
    expect(table.columns).toEqual(['id', 'name', 'role'])
    expect(table.rows).toEqual([['1', 'Ada', ''], ['2', 'Bo', 'admin']])
  })

  test('nested values are summarized, not expanded', () => {
    const table = tableOf({ t: 'array', length: 1, items: [{ t: 'object', entries: [['tags', { t: 'array', length: 3, items: [] }], ['owner', model(7, 'Cy')], ['at', { t: 'date', v: '2026-01-01T00:00:00.000Z' }], ['gone', { t: 'null' }]] }] })!
    expect(table.rows[0]).toEqual(['[3 items]', 'User #7', '2026-01-01T00:00:00.000Z', 'null'])
  })

  test('what is not a list of records has no table', () => {
    expect(tableOf({ t: 'array', length: 2, items: [n(1), n(2)] })).toBeNull()
    expect(tableOf({ t: 'array', length: 0, items: [] })).toBeNull()
    expect(tableOf(model(1, 'Ada'))).toBeNull()
    expect(tableOf(null)).toBeNull()
  })

  test('the count the session cut off is carried', () => {
    expect(tableOf({ t: 'array', length: 500, more: 300, items: [model(1, 'Ada')] })!.more).toBe(300)
  })

  test('CSV quotes what needs it and disarms formulas', () => {
    const table = { columns: ['name', 'note'], rows: [['Ada, Countess', 'said "hi"'], ['=SUM(A1)', 'line\nbreak']], more: 0 }
    expect(tableToCsv(table)).toBe('name,note\n"Ada, Countess","said ""hi"""\n\'=SUM(A1),"line\nbreak"')
    expect(JSON.parse(tableToJson(table))[0]).toEqual({ name: 'Ada, Countess', note: 'said "hi"' })
  })

  test('rows filter by any cell and sort numbers as numbers', () => {
    const table = { columns: ['id', 'name'], rows: [['10', 'Ada'], ['9', 'Bo'], ['100', 'Cy']], more: 0 }
    expect(viewRows(table, 'b', null)).toEqual([['9', 'Bo']])
    expect(viewRows(table, '', { column: 0, descending: false }).map(row => row[0])).toEqual(['9', '10', '100'])
    expect(viewRows(table, '', { column: 1, descending: true }).map(row => row[1])).toEqual(['Cy', 'Bo', 'Ada'])
    expect(table.rows[0]).toEqual(['10', 'Ada'])
  })
})
