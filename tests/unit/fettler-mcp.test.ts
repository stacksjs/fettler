import { describe, expect, test } from 'bun:test'
import { createMCPServer } from '@stacksjs/ai'
import { mcpTools, summarizeFrames, tokenMatches } from '../../app/Fettler/mcp'
import { Store } from '../../app/Fettler/store'

function setup(environment = 'local') {
  const store = new Store(':memory:')
  store.touchConnection({ key: 'local:/apps/shop', kind: 'local', label: 'shop', path: '/apps/shop', spec: { kind: 'local', path: '/apps/shop' } })
  const ran: string[] = []
  const opened: string[] = []
  let current: any = { connection: { kind: 'local', path: '/apps/shop' }, environment }
  const host = {
    current: () => current,
    open: async (key: string) => {
      opened.push(key)
      current = { connection: { kind: 'sandbox' }, environment: '' }
      return { environment: '' }
    },
    run: async (code: string, onFrame: (frame: any) => void) => {
      ran.push(code)
      onFrame({ type: 'stdout', id: 'r', text: 'hello\n' })
      onFrame({ type: 'result', id: 'r', value: 42, durationMs: 1 })
      onFrame({ type: 'done', id: 'r', ok: true })
    },
    models: () => [{ name: 'User', attributes: ['name'], relations: [] }],
  }
  const server = createMCPServer({
    name: 'fettler',
    version: '0.0.0',
    authenticate: request => tokenMatches(request.headers.get('authorization'), 'secret-token') ? { ok: true } : new Response('Unauthorized', { status: 401 }),
    tools: mcpTools(host as any, store, value => String(value)) as any,
  })
  const call = async (name: string, args: Record<string, unknown> = {}, token = 'secret-token') => {
    const response = await server.handle(new Request('http://127.0.0.1/__fettler/mcp', {
      method: 'POST',
      headers: { 'authorization': `Bearer ${token}`, 'content-type': 'application/json', 'accept': 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    }))
    return { status: response.status, body: response.status === 200 ? await response.json() as any : null }
  }
  return { call, ran, opened, store }
}

describe('Fettler over MCP', () => {
  test('a wrong token is refused before anything is looked at', async () => {
    const { call, ran } = setup()
    expect((await call('evaluate', { code: '1' }, 'wrong')).status).toBe(401)
    expect(ran).toEqual([])
    expect(tokenMatches('Bearer secret-token', 'secret-token')).toBe(true)
    expect(tokenMatches(null, 'secret-token')).toBe(false)
  })

  test('evaluate runs in the open connection and returns output and result', async () => {
    const { call, ran } = setup()
    const { body } = await call('evaluate', { code: 'User.count()' })
    expect(ran).toEqual(['User.count()'])
    expect(body.result.isError).toBeFalsy()
    expect(body.result.content[0].text).toBe('hello\nresult (1 ms):\n42')
  })

  test('production is refused unless the call confirms it', async () => {
    const { call, ran } = setup('production')
    const refused = await call('evaluate', { code: 'User.truncate()' })
    expect(refused.body.result.isError).toBe(true)
    expect(refused.body.result.content[0].text).toContain('Nothing was run')
    expect(ran).toEqual([])
    await call('evaluate', { code: 'User.count()', confirm_production: true })
    expect(ran).toEqual(['User.count()'])
  })

  test('a named connection is opened first', async () => {
    const { call, opened, ran } = setup()
    await call('evaluate', { code: '1 + 1', connection: 'sandbox' })
    expect(opened).toEqual(['sandbox'])
    expect(ran).toEqual(['1 + 1'])
  })

  test('connections, models and snippets are listed and a snippet can be added', async () => {
    const { call, store } = setup()
    expect(JSON.parse((await call('list_connections')).body.result.content[0].text).recent[0]).toMatchObject({ key: 'local:/apps/shop', label: 'shop' })
    expect((await call('list_models')).body.result.content[0].text).toContain('"User"')
    expect((await call('add_snippet', { title: 'Count', code: 'User.count()' })).body.result.content[0].text).toContain('Saved snippet')
    expect(store.snippets().map(snippet => snippet.title)).toEqual(['Count'])
    expect((await call('get_snippets')).body.result.content[0].text).toContain('User.count()')
  })
})

describe('summarizeFrames', () => {
  test('orders output, probes, queries and the result, and reports failure', () => {
    const summary = summarizeFrames([
      { type: 'probe', id: 'r', line: 0, kind: 'value', value: 'v' },
      { type: 'query', id: 'r', sql: 'select 1', durationMs: 2 },
      { type: 'error', id: 'r', error: 'boom', phase: 'run', durationMs: 3 },
      { type: 'done', id: 'r', ok: false },
    ] as any, value => String(value))
    expect(summary).toEqual({ ok: false, text: 'line 1: v\nquery (2 ms): select 1\nerror:\nboom' })
  })
})
