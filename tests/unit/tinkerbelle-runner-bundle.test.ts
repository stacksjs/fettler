import { afterEach, describe, expect, test } from 'bun:test'
import process from 'node:process'
import { runnerInputs, STDIN_LOADER } from '../../app/TinkerBelle/remote'
import { Runner } from '../../app/TinkerBelle/runner'
import { RUNNER_BUNDLE, RUNNER_INPUTS } from '../../app/TinkerBelle/runner-bundle'
import { commandFor } from '../../app/TinkerBelle/targets'

let runner: Runner | undefined
afterEach(() => {
  runner?.stop()
  runner = undefined
})

describe('the runner the built app carries', () => {
  test('was built from the entry and session engine that are installed now', async () => {
    // Fails after a tinker upgrade until `bun app/TinkerBelle/build-runner.ts` is run.
    expect(RUNNER_INPUTS).toBe(await runnerInputs())
    expect(RUNNER_BUNDLE).toContain('__tinkerbelleServe')
  })

  test('the sandbox starts from the loader alone, with no source file in its command', async () => {
    const command = await commandFor({ kind: 'sandbox' })
    expect(command.command).toEqual([process.execPath, '-e', STDIN_LOADER])
    // What makes the built app's own executable act as Bun.
    expect(command.env?.BUN_BE_BUN).toBe('1')
    runner = new Runner(command)
    await runner.ready
    const frames: any[] = []
    await runner.run('[1, 2, 3].map(n => n * 2)', frame => frames.push(frame))
    expect(frames.find(frame => frame.type === 'result')?.value.items.map((item: any) => item.v)).toEqual([2, 4, 6])
  }, 30_000)
})
