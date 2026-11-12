import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Runner, RunnerExited } from '../../app/Fettler/runner'
import { commandFor, ConnectionError, summarize } from '../../app/Fettler/targets'

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
    runner = new Runner(commandFor({ kind: 'sandbox' }))
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
    runner = new Runner(commandFor({ kind: 'sandbox' }))
    const failed = await collect(runner, 'throw new RangeError("nope")')
    expect(failed.find(frame => frame.type === 'error').error).toMatchObject({ name: 'RangeError', message: 'nope' })
    expect(failed.at(-1)).toMatchObject({ type: 'done', ok: false })
    const after = await collect(runner, '1 + 1')
    expect(after.find(frame => frame.type === 'result').value).toEqual({ t: 'number', v: 2 })
  }, 20_000)

  test('a session that ends rejects the run in flight and later ones', async () => {
    runner = new Runner(commandFor({ kind: 'sandbox' }))
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
  test('refuses a directory that is not a Stacks project, saying why', () => {
    const empty = mkdtempSync(join(tmpdir(), 'fettler-target-'))
    expect(() => commandFor({ kind: 'local', path: empty })).toThrow(ConnectionError)
    expect(() => commandFor({ kind: 'local', path: empty })).toThrow(/no buddy file/)
    expect(() => commandFor({ kind: 'local', path: join(empty, 'missing') })).toThrow(/does not exist/)
  })

  test('runs this app through its own buddy', () => {
    const root = join(import.meta.dir, '../..')
    expect(commandFor({ kind: 'local', path: root })).toEqual({ command: [join(root, 'buddy'), 'tinker', '--serve'], cwd: root })
    expect(summarize({ kind: 'local', path: root })).toMatchObject({ kind: 'local', label: 'fettler' })
  })
})
