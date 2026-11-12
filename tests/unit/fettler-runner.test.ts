import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { declaredEnvKeys, sessionEnvironment } from '../../app/Fettler/environment'
import { Runner, RunnerExited } from '../../app/Fettler/runner'
import { commandFor, ConnectionError, projectKind, summarize, validate } from '../../app/Fettler/targets'

let runner: Runner | undefined
afterEach(() => {
  runner?.stop()
  runner = undefined
})

async function collect(target: Runner, code: string): Promise<any[]> {
  const frames: any[] = []
  await target.run(code, frame => frames.push(frame))
  return frames
}

describe('a sandbox session', () => {
  test('reports ready, runs code and keeps state between runs', async () => {
    runner = new Runner(await commandFor({ kind: 'sandbox' }))
    const info = await runner.ready
    expect(info.booted).toBe(false)

    const first = await collect(runner, 'console.log("hi"); const n = 20; n + 1')
    expect(first.map(frame => frame.type)).toEqual(['stdout', 'result', 'done'])
    expect(first[0].text).toBe('hi\n')
    expect(first[1].value).toEqual({ t: 'number', v: 21 })

    const second = await collect(runner, 'n * 2')
    expect(second.find(frame => frame.type === 'result').value).toEqual({ t: 'number', v: 40 })
  }, 20_000)

  test('an error is a frame, and the session survives it', async () => {
    runner = new Runner(await commandFor({ kind: 'sandbox' }))
    const failed = await collect(runner, 'throw new RangeError("nope")')
    expect(failed.find(frame => frame.type === 'error').error).toMatchObject({ name: 'RangeError', message: 'nope' })
    expect(failed.at(-1)).toMatchObject({ type: 'done', ok: false })
    const after = await collect(runner, '1 + 1')
    expect(after.find(frame => frame.type === 'result').value).toEqual({ t: 'number', v: 2 })
  }, 20_000)

  test('a session that ends rejects the run in flight and later ones', async () => {
    runner = new Runner(await commandFor({ kind: 'sandbox' }))
    await runner.ready
    await expect(runner.run('process.exit(3)', () => {})).rejects.toBeInstanceOf(RunnerExited)
    expect(runner.running).toBe(false)
    await expect(runner.run('1', () => {})).rejects.toBeInstanceOf(RunnerExited)
  }, 20_000)
})

describe('a command that is not a session', () => {
  test('rejects ready with what it printed', async () => {
    runner = new Runner({ command: ['sh', '-c', 'echo "bun: command not found" >&2; exit 127'] })
    await expect(runner.ready).rejects.toThrow(/exit 127.*command not found/)
  })
})

describe('local project targets', () => {
  test('refuses a directory that is not a project, saying why', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'fettler-target-'))
    await expect(commandFor({ kind: 'local', path: empty })).rejects.toBeInstanceOf(ConnectionError)
    await expect(commandFor({ kind: 'local', path: empty })).rejects.toThrow(/no package\.json/)
    await expect(commandFor({ kind: 'local', path: join(empty, 'missing') })).rejects.toThrow(/does not exist/)
  })

  test('a Stacks project boots its app; any other project is a plain Bun session in its directory', async () => {
    const root = join(import.meta.dir, '../..')
    expect(projectKind(root)).toBe('stacks')
    const stacks = await commandFor({ kind: 'local', path: root })
    expect(stacks).toMatchObject({ cwd: root, env: { FETTLER_BOOT: '1' } })
    expect(summarize({ kind: 'local', path: root })).toMatchObject({ kind: 'local', label: 'fettler', driver: 'stacks' })

    const plain = mkdtempSync(join(tmpdir(), 'fettler-plain-'))
    writeFileSync(join(plain, 'package.json'), '{ "name": "plain" }')
    writeFileSync(join(plain, 'lib.ts'), 'export const answer = 41\n')
    expect(projectKind(plain)).toBe('bun')
    runner = new Runner(await commandFor({ kind: 'local', path: plain }))
    expect((await runner.ready).booted).toBe(false)
    const frames = await collect(runner, 'const { answer } = await import("./lib.ts"); answer + 1')
    expect(frames.find(frame => frame.type === 'result').value).toEqual({ t: 'number', v: 42 })
  }, 30_000)
})

describe('remote targets', () => {
  test('a field that would be read as an option or a command is refused', () => {
    const base = { kind: 'ssh' as const, directory: '/var/www/app' }
    expect(() => validate({ ...base, host: '-oProxyCommand=evil' })).toThrow(ConnectionError)
    expect(() => validate({ ...base, host: 'box; rm -rf /' })).toThrow(ConnectionError)
    expect(() => validate({ ...base, host: 'box', user: 'root -o x' })).toThrow(ConnectionError)
    expect(() => validate({ ...base, host: 'box', port: 70000 })).toThrow(/port/)
    expect(() => validate({ ...base, host: 'box', jump: '-J evil' })).toThrow(ConnectionError)
    expect(() => validate({ kind: 'ssh', host: 'box', directory: 'relative/path' })).toThrow(/absolute/)
    expect(() => validate({ kind: 'docker', container: '--privileged', directory: '/app' })).toThrow(ConnectionError)
    expect(() => validate({ kind: 'kube', pod: 'api-0', namespace: 'prod; x', directory: '/app' })).toThrow(ConnectionError)
    expect(() => validate({ ...base, host: 'box.example', user: 'deploy', port: 22, jump: 'me@bastion:2222' })).not.toThrow()
  })

  test('each has a label, a place and a stable key', () => {
    expect(summarize({ kind: 'ssh', host: 'box', user: 'root', directory: '/var/www/shop-api/current' }))
      .toEqual({ kind: 'ssh', label: 'shop-api', path: '/var/www/shop-api/current', where: 'root@box', key: 'ssh:root@box:/var/www/shop-api/current' })
    expect(summarize({ kind: 'docker', container: 'web-1', directory: '/app' }).key).toBe('docker:web-1:/app')
    expect(summarize({ kind: 'kube', pod: 'api-0', namespace: 'prod', context: 'live', directory: '/app' }).where).toBe('live/prod/api-0')
  })
})

describe('a session\'s environment', () => {
  test('leaves out what this app declared for itself, by name', () => {
    const root = mkdtempSync(join(tmpdir(), 'fettler-env-own-'))
    writeFileSync(join(root, '.env'), 'APP_NAME=Fettler\nexport DB_CONNECTION="sqlite"\n# COMMENTED=1\n  lower_case=ok\n')
    writeFileSync(join(root, '.env.local'), 'SECRET_KEY=abc\n')
    const own = declaredEnvKeys(root)
    expect([...own].sort()).toEqual(['APP_NAME', 'DB_CONNECTION', 'SECRET_KEY', 'lower_case'])
    const environment = sessionEnvironment(own, { FETTLER_BOOT: '1' }, { APP_NAME: 'Fettler', PATH: '/usr/bin', SECRET_KEY: 'abc', HOME: '/h' })
    expect(environment).toEqual({ PATH: '/usr/bin', HOME: '/h', FETTLER_BOOT: '1' })
  })

  test('a project sees its own name, not this app\'s', async () => {
    const project = mkdtempSync(join(tmpdir(), 'fettler-env-project-'))
    writeFileSync(join(project, 'package.json'), '{ "name": "other" }')
    writeFileSync(join(project, '.env'), 'APP_NAME=Other\n')
    runner = new Runner(await commandFor({ kind: 'local', path: project }))
    const frames = await collect(runner, 'process.env.APP_NAME')
    expect(frames.find(frame => frame.type === 'result').value).toEqual({ t: 'string', v: 'Other' })
  }, 30_000)
})
