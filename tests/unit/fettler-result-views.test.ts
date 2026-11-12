import { describe, expect, test } from 'bun:test'
import { modelsIn, neighbourhood } from '../../resources/functions/relation-graph'
import { gridOf } from '../../resources/functions/tinker-table'

const str = (v: string) => ({ t: 'string', v })
const num = (v: number) => ({ t: 'number', v })

describe('result grid', () => {
  test('a list of records becomes typed rows', () => {
    const grid = gridOf({
      t: 'array',
      length: 2,
      items: [
        { t: 'object', entries: [['id', num(1)], ['name', str('Ada')], ['tags', { t: 'array', length: 2, items: [] }]] },
        { t: 'object', entries: [['id', num(2)], ['left', { t: 'null' }]] },
      ],
      more: 3,
    })
    expect(grid?.columns.map(column => column.key)).toEqual(['id', 'name', 'tags', 'left'])
    expect(grid?.rows[0]).toEqual({ id: 1, name: 'Ada', tags: '[2 items]', left: undefined })
    expect(grid?.rows[1]).toEqual({ id: 2, name: undefined, tags: undefined, left: null })
    expect(grid?.more).toBe(3)
  })

  test('a value that is not a list of records has no grid', () => {
    expect(gridOf(num(1))).toBeNull()
    expect(gridOf({ t: 'array', length: 1, items: [num(1)] })).toBeNull()
  })
})

describe('relation graph', () => {
  const models = [
    { name: 'User', table: 'users', relations: [{ kind: 'hasMany', model: 'Post' }, { kind: 'belongsTo', model: 'Team' }] },
    { name: 'Post', table: 'posts', relations: [{ kind: 'belongsTo', model: 'User' }] },
    { name: 'Team', table: 'teams', relations: [] },
  ]

  test('finds the models a result is made of', () => {
    expect(modelsIn({ t: 'model', model: 'User' })).toEqual(['User'])
    expect(modelsIn({ t: 'array', items: [{ t: 'model', model: 'Post' }, { t: 'model', model: 'Post' }, num(1)] })).toEqual(['Post'])
    expect(modelsIn(num(1))).toEqual([])
  })

  test('draws a model and what is one relation away', () => {
    const { nodes, edges } = neighbourhood(models, ['User'])
    expect(nodes.map(node => node.id)).toEqual(['User', 'Post', 'Team'])
    expect(edges).toEqual([{ source: 'User', target: 'Post', label: 'hasMany' }, { source: 'User', target: 'Team', label: 'belongsTo' }])
    // The start is already open; a model with relations can be opened; one without cannot.
    expect(nodes.map(node => node.expandable)).toEqual([false, true, false])
  })

  test('a model the session does not list is still a node', () => {
    const { nodes } = neighbourhood(models, ['Ghost'])
    expect(nodes).toEqual([{ id: 'Ghost', label: 'Ghost', kind: 'model', expandable: false }])
  })
})
