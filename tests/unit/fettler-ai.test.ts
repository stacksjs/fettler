import { describe, expect, test } from 'bun:test'
import { AiNotReady, Assistant, describeModels, extractCode } from '../../app/Fettler/ai'
import { Store } from '../../app/Fettler/store'

function setup() {
  const store = new Store(':memory:')
  const kept = new Map<string, string>()
  const secrets = {
    get: async (name: string) => kept.get(name) ?? null,
    set: async (name: string, value: string) => { kept.set(name, value) },
    delete: async (name: string) => { kept.delete(name) },
  }
  const calls: any[] = []
  const load = async () => ({
    complete: async (input: any, runtime: any) => {
      calls.push({ kind: 'complete', input, runtime })
      return { completion: 'count()' }
    },
    createAIClient: (config: any) => ({
      generate: async (messages: any, options: any) => {
        calls.push({ kind: 'chat', config, messages, options })
        return { content: 'Here:\n```ts\nawait User.count()\n```\nCounts users.' }
      },
    }),
  })
  return { assistant: new Assistant(store, secrets, load as any), kept, calls, store }
}

const models = [{ name: 'User', table: 'users', attributes: ['name', 'email'], relations: [{ kind: 'hasMany', model: 'Post' }] }]

describe('the assistant', () => {
  test('is off until turned on, and needs a key for a hosted provider', async () => {
    const { assistant } = setup()
    await expect(assistant.suggest({ before: 'User.' })).rejects.toThrow(AiNotReady)
    await assistant.update({ enabled: true })
    await expect(assistant.suggest({ before: 'User.' })).rejects.toThrow(/Anthropic API key/)
  })

  test('the key goes to the keychain and never comes back out', async () => {
    const { assistant, kept, store } = setup()
    const status = await assistant.update({ enabled: true, provider: 'openai', key: '  sk-secret  ' })
    expect(status).toMatchObject({ provider: 'openai', hasKey: true })
    expect(JSON.stringify(status)).not.toContain('sk-secret')
    expect(kept.get('ai.openai')).toBe('sk-secret')
    expect(JSON.stringify(store.setting('ai', {}))).not.toContain('sk-secret')
    expect((await assistant.update({ key: null })).hasKey).toBe(false)
  })

  test('a suggestion is asked for as code, with model names as context and the key in the driver config', async () => {
    const { assistant, calls } = setup()
    await assistant.update({ enabled: true, key: 'k', model: 'fast-one' })
    expect(await assistant.suggest({ before: 'await User.', after: '\n', models })).toBe('count()')
    expect(calls[0].input).toMatchObject({ before: 'await User.', kind: 'code', context: 'User(name, email); relations: hasMany Post' })
    expect(calls[0].runtime.config).toMatchObject({ default: 'anthropic', drivers: { anthropic: { apiKey: 'k', model: 'fast-one' } } })
    expect(await assistant.suggest({ before: '   ' })).toBe('')
  })

  test('an answer comes back with its code pulled out, and the prompt carries shape, not data', async () => {
    const { assistant, calls } = setup()
    await assistant.update({ enabled: true, key: 'k' })
    const reply = await assistant.ask({ messages: [{ role: 'user', content: 'how many users?' }], code: 'const x = 1', models })
    expect(reply.code).toBe('await User.count()')
    const system = calls[0].options.system as string
    expect(system).toContain('User(name, email); relations: hasMany Post')
    expect(system).toContain('const x = 1')
    expect(system).toContain('do not invent it')
  })

  test('ollama needs no key and is given its host', async () => {
    const { assistant, calls } = setup()
    await assistant.update({ enabled: true, provider: 'ollama', host: 'http://127.0.0.1:11434' })
    expect((await assistant.status()).hasKey).toBe(true)
    await assistant.suggest({ before: 'x.' })
    expect(calls[0].runtime.config.drivers.ollama).toMatchObject({ host: 'http://127.0.0.1:11434' })
  })

  test('a host that is not a plain http address is ignored', async () => {
    const { assistant } = setup()
    expect((await assistant.update({ host: 'file:///etc/passwd' })).host).toBe('http://127.0.0.1:11434')
  })
})

describe('helpers', () => {
  test('describeModels lists names only and says how many it left out', () => {
    const many = Array.from({ length: 3 }, (_, index) => ({ name: `M${index}`, attributes: ['a'], relations: [] }))
    expect(describeModels(many, 2)).toBe('M0(a)\nM1(a)\nand 1 more models')
    expect(describeModels([])).toBe('')
  })

  test('extractCode takes the first fenced block', () => {
    expect(extractCode('x\n```ts\na()\nb()\n```\ny\n```ts\nc()\n```')).toBe('a()\nb()')
    expect(extractCode('no code here')).toBeNull()
  })
})
