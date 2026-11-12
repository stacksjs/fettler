import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startAgent } from '../../app/TinkerBelle/agent'

// The whole agent over real HTTP, with its database in a temp directory and
// its secrets in memory, so nothing of the developer's is read or written.
const kept = new Map<string, string>()
const secrets = {
  get: async (name: string) => kept.get(name) ?? null,
  set: async (name: string, value: string) => { kept.set(name, value) },
  delete: async (name: string) => { kept.delete(name) },
}

let base = ''
let cookie = ''
let stop = (): void => {}

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${base}${path}`, { ...init, headers: { 'content-type': 'application/json', cookie, ...init.headers } })
}

beforeAll(async () => {
  const agent = await startAgent({ storePath: join(mkdtempSync(join(tmpdir(), 'tinkerbelle-agent-')), 'tinkerbelle.sqlite'), secrets })
  stop = agent.stop
  base = `http://127.0.0.1:${agent.port}`
  const trade = await fetch(agent.url, { redirect: 'manual' })
  expect(trade.status).toBe(302)
  cookie = (trade.headers.get('set-cookie') ?? '').split(';')[0]!
  expect(trade.headers.get('set-cookie')).toContain('HttpOnly')
}, 60_000)

afterAll(() => stop())

describe('the agent', () => {
  test('answers only its own window and only on its own host', async () => {
    expect((await fetch(`${base}/__tinkerbelle/state`)).status).toBe(401)
    expect((await fetch(`${base}/`)).status).toBe(401)
    expect((await fetch(`${base}/__tinkerbelle/state`, { headers: { cookie, host: 'evil.test' } })).status).toBe(403)
    expect((await api('/__tinkerbelle/state')).status).toBe(200)
  })

  test('runs code in the sandbox, streams frames, and records the run', async () => {
    const connected = await (await api('/__tinkerbelle/connect', { method: 'POST', body: JSON.stringify({ kind: 'sandbox' }) })).json() as any
    expect(connected.connection).toMatchObject({ kind: 'sandbox', key: 'sandbox' })
    const frames = (await (await api('/__tinkerbelle/run', { method: 'POST', body: JSON.stringify({ code: 'console.log("out"); 20 + 22' }) })).text()).trim().split('\n').map(line => JSON.parse(line))
    expect(frames.map(frame => frame.type)).toEqual(['stdout', 'result', 'done'])
    expect(frames[1].value).toEqual({ t: 'number', v: 42 })
    const history = await (await api('/__tinkerbelle/history')).json() as any
    expect(history.entries.map((entry: any) => [entry.code, entry.ok])).toEqual([['console.log("out"); 20 + 22', true]])
  }, 30_000)

  test('a project driver boots, adds globals and panels; panels are text only', async () => {
    const project = mkdtempSync(join(tmpdir(), 'tinkerbelle-driven-'))
    mkdirSync(join(project, '.tinkerbelle'))
    writeFileSync(join(project, 'package.json'), '{ "name": "driven" }')
    writeFileSync(join(project, '.tinkerbelle/driver.ts'), `export default {
  name: 'Driven',
  boot() { (globalThis as any).booted = true },
  globals: () => ({ shop: { id: 7 } }),
  panels: () => [{ title: 'Sales', sections: [{ title: 'Today', rows: [['Orders', 12], ['Meta', { a: 1 }]] }] }],
}
`)
    const connected = await (await api('/__tinkerbelle/connect', { method: 'POST', body: JSON.stringify({ kind: 'local', path: project }) })).json() as any
    expect(connected.connection).toMatchObject({ kind: 'local', driver: 'bun' })
    const frames = (await (await api('/__tinkerbelle/run', { method: 'POST', body: JSON.stringify({ code: '[booted, shop.id]' }) })).text()).trim().split('\n').map(line => JSON.parse(line))
    expect(frames.find(frame => frame.type === 'result').value.items).toEqual([{ t: 'boolean', v: true }, { t: 'number', v: 7 }])
    const info = await (await api('/__tinkerbelle/panels')).json() as any
    expect(info.driver).toBe('Driven')
    expect(info.panels.map((panel: any) => panel.title)).toEqual(['Runtime', 'Sales'])
    expect(info.panels[1].sections[0]).toEqual({ title: 'Today', rows: [['Orders', '12'], ['Meta', '{"a":1}']] })
    await api('/__tinkerbelle/connect', { method: 'POST', body: JSON.stringify({ kind: 'sandbox' }) })
  }, 30_000)

  test('refuses a remote target whose host would be read as an option', async () => {
    const response = await api('/__tinkerbelle/connect', { method: 'POST', body: JSON.stringify({ kind: 'ssh', host: '-oProxyCommand=x', directory: '/app' }) })
    expect(response.status).toBe(422)
  })

  test('MCP is closed until turned on, then opens to its token alone', async () => {
    const rpc = (token: string, method: string, params: unknown) => fetch(`${base}/__tinkerbelle/mcp`, {
      method: 'POST',
      headers: { 'authorization': `Bearer ${token}`, 'content-type': 'application/json', 'accept': 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    })
    expect((await rpc('anything', 'tools/list', {})).status).toBe(404)

    const enabled = await (await api('/__tinkerbelle/mcp-settings', { method: 'POST', body: JSON.stringify({ enabled: true }) })).json() as any
    expect(enabled.token.length).toBeGreaterThan(40)
    expect(kept.get('mcp.token')).toBe(enabled.token)
    expect(JSON.stringify(await (await api('/__tinkerbelle/mcp-settings')).json())).not.toContain(enabled.token)

    expect((await rpc('wrong', 'tools/list', {})).status).toBe(401)
    // The window's cookie is not an MCP credential.
    expect((await fetch(`${base}/__tinkerbelle/mcp`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{}' })).status).toBe(401)

    const listed = await (await rpc(enabled.token, 'tools/list', {})).json() as any
    expect(listed.result.tools.map((tool: any) => tool.name)).toEqual(['list_connections', 'evaluate', 'list_models', 'get_snippets', 'add_snippet'])

    const ran = await (await rpc(enabled.token, 'tools/call', { name: 'evaluate', arguments: { code: 'const viaMcp = 6; viaMcp * 7' } })).json() as any
    expect(ran.result.content[0].text).toContain('42')

    await api('/__tinkerbelle/mcp-settings', { method: 'POST', body: JSON.stringify({ enabled: false }) })
    expect((await rpc(enabled.token, 'tools/list', {})).status).toBe(404)
    expect(kept.has('mcp.token')).toBe(false)
  }, 30_000)

  test('the AI key never comes back from the API', async () => {
    const saved = await (await api('/__tinkerbelle/ai', { method: 'POST', body: JSON.stringify({ enabled: true, provider: 'openai', key: 'sk-test-not-real' }) })).json() as any
    expect(saved).toMatchObject({ enabled: true, provider: 'openai', hasKey: true })
    expect(JSON.stringify(saved)).not.toContain('sk-test-not-real')
    expect(JSON.stringify(await (await api('/__tinkerbelle/ai')).json())).not.toContain('sk-test-not-real')
    expect(kept.get('ai.openai')).toBe('sk-test-not-real')
  })
})

describe('the agent with Pro locked', () => {
  test('local work is free; remote targets, AI and MCP answer 402 and say what they need', async () => {
    const locked = await startAgent({
      storePath: join(mkdtempSync(join(tmpdir(), 'tinkerbelle-locked-')), 'tinkerbelle.sqlite'),
      secrets,
      licensing: { openBeta: false, publicKeys: {} },
    })
    try {
      const origin = `http://127.0.0.1:${locked.port}`
      const trade = await fetch(locked.url, { redirect: 'manual' })
      const session = (trade.headers.get('set-cookie') ?? '').split(';')[0]!
      const call = (path: string, init: RequestInit = {}) => fetch(`${origin}${path}`, { ...init, headers: { 'content-type': 'application/json', 'cookie': session } })

      expect(await (await call('/__tinkerbelle/license')).json()).toMatchObject({ pro: false, source: 'none' })
      expect((await call('/__tinkerbelle/connect', { method: 'POST', body: JSON.stringify({ kind: 'sandbox' }) })).status).toBe(200)

      const remote = await call('/__tinkerbelle/connect', { method: 'POST', body: JSON.stringify({ kind: 'ssh', host: 'box.example', directory: '/app' }) })
      expect(remote.status).toBe(402)
      expect(await remote.json()).toMatchObject({ needsPro: 'remote' })

      expect((await call('/__tinkerbelle/ai/suggest', { method: 'POST', body: JSON.stringify({ before: 'x.' }) })).status).toBe(402)
      expect((await call('/__tinkerbelle/mcp-settings', { method: 'POST', body: JSON.stringify({ enabled: true }) })).status).toBe(402)
      expect(await (await call('/__tinkerbelle/license', { method: 'POST', body: JSON.stringify({ key: 'ABCD' }) })).json()).toMatchObject({ ok: false, reason: 'not-open' })
    }
    finally {
      locked.stop()
    }
  }, 60_000)
})
