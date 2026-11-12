import { afterAll, describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { findLanguageServer, LanguageService } from '../../app/TinkerBelle/language'

const root = join(import.meta.dir, '../..')
const binary = findLanguageServer(root, root)
let service: LanguageService | undefined
afterAll(() => service?.stop())

describe.skipIf(!binary)('language service on this app', () => {
  test('completes a model instance with its columns and methods', async () => {
    service = new LanguageService(root, binary!)
    const text = 'const user = await User.find(1)\nuser?.'
    const items = await service.complete(text, { line: 1, column: 6 })
    const labels = items.map(item => item.label)
    expect(labels).toContain('created_at')
    expect(labels).toContain('save')
  }, 30_000)

  test('reports a real type error on the right line, and not unused locals', async () => {
    const diagnostics = await service!.diagnostics('const name = config.app.name\nconst count: number = name\n')
    expect(diagnostics.map(item => [item.from.line, item.severity])).toEqual([[1, 'error']])
    expect(diagnostics[0]!.message).toContain('not assignable to type \'number\'')
  }, 30_000)

  test('names the parameter being typed inside a call', async () => {
    const text = 'function greet(name: string, times: number) {}\ngreet("Ada", '
    const help = await service!.signature(text, { line: 1, column: 13 })
    expect(help?.label).toContain('greet(name: string, times: number)')
    expect(help?.parameters.map(parameter => parameter.label)).toEqual(['name: string', 'times: number'])
    expect(help?.active).toBe(1)
  }, 30_000)

  test('hovers a global with its type', async () => {
    const hover = await service!.hover('User', { line: 0, column: 1 })
    expect(hover).toContain('User')
  }, 30_000)

  test('writes nothing into the project', () => {
    expect(existsSync(join(root, 'app/__tinkerbelle_scratch__.ts'))).toBe(false)
  })
})
