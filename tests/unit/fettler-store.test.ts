import { describe, expect, test } from 'bun:test'
import { Store } from '../../app/Fettler/store'

describe('the local store', () => {
  test('history is newest first, per connection, and searchable', () => {
    const store = new Store(':memory:')
    store.recordRun('local:/a', 'User.count()', true, 3)
    store.recordRun('local:/a', 'Order.sum("total")', false, 9)
    store.recordRun('local:/b', 'Post.all()', true, 1)
    expect(store.history({ connection: 'local:/a' }).map(entry => [entry.code, entry.ok])).toEqual([['Order.sum("total")', false], ['User.count()', true]])
    expect(store.history({ search: 'count' }).map(entry => entry.code)).toEqual(['User.count()'])
    expect(store.history().length).toBe(3)
  })

  test('running the same code again does not repeat it, and blank code is not kept', () => {
    const store = new Store(':memory:')
    store.recordRun('sandbox', '1 + 1', false, 1)
    store.recordRun('sandbox', '1 + 1', true, 2)
    store.recordRun('sandbox', '   ', true, 0)
    expect(store.history().map(entry => [entry.code, entry.ok, entry.durationMs])).toEqual([['1 + 1', true, 2]])
  })

  test('a search treats percent and underscore as text', () => {
    const store = new Store(':memory:')
    store.recordRun('sandbox', 'a_b', true, 1)
    store.recordRun('sandbox', 'axb', true, 1)
    store.recordRun('sandbox', '100%', true, 1)
    expect(store.history({ search: '_' }).map(entry => entry.code)).toEqual(['a_b'])
    expect(store.history({ search: '%' }).map(entry => entry.code)).toEqual(['100%'])
  })

  test('snippets save, update, list a project first and delete', () => {
    const store = new Store(':memory:')
    const everywhere = store.saveSnippet({ title: 'Count users', code: 'User.count()' })
    const scoped = store.saveSnippet({ title: '  ', code: 'x', connection: 'local:/a' })
    expect(scoped.title).toBe('Untitled')
    expect(store.snippets('local:/a').map(snippet => snippet.id)).toEqual([scoped.id, everywhere.id])
    expect(store.snippets('local:/b').map(snippet => snippet.id)).toEqual([everywhere.id])
    expect(store.saveSnippet({ id: everywhere.id, title: 'Renamed', code: 'User.count()' }).title).toBe('Renamed')
    store.deleteSnippet(scoped.id)
    expect(store.snippets().map(snippet => snippet.title)).toEqual(['Renamed'])
  })

  test('recent connections are most recent first and updated in place', async () => {
    const store = new Store(':memory:')
    store.touchConnection({ key: 'local:/a', kind: 'local', label: 'a', path: '/a' })
    await Bun.sleep(5)
    store.touchConnection({ key: 'sandbox', kind: 'sandbox', label: 'Sandbox' })
    await Bun.sleep(5)
    store.touchConnection({ key: 'local:/a', kind: 'local', label: 'renamed', path: '/a' })
    expect(store.recentConnections().map(item => [item.key, item.label])).toEqual([['local:/a', 'renamed'], ['sandbox', 'Sandbox']])
    store.forgetConnection('sandbox')
    expect(store.recentConnections().length).toBe(1)
  })

  test('settings round-trip any JSON value and fall back when unset', () => {
    const store = new Store(':memory:')
    expect(store.setting('theme', 'system')).toBe('system')
    store.setSetting('theme', { mode: 'dark', size: 13 })
    expect(store.setting('theme', 'system')).toEqual({ mode: 'dark', size: 13 })
  })
})
