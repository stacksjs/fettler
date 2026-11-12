import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dockerArguments, kubectlArguments, runnerPreamble, sessionScript, shellCommand, sshArguments, sshCommand, STDIN_LOADER, throughShell } from '../../app/TinkerBelle/remote'
import { Runner } from '../../app/TinkerBelle/runner'

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

describe('the stdin loader', () => {
  test('has no single quote, so a shell script can single-quote it', () => {
    expect(STDIN_LOADER.includes('\'')).toBe(false)
  })

  test('a bare session runs through sh with nothing written to the directory', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'tinkerbelle-remote-'))
    writeFileSync(join(directory, 'mod.ts'), 'export const here = "there"\n')
    runner = new Runner(await shellCommand({ directory, boot: false }))
    const info = await runner.ready
    expect(info.booted).toBe(false)
    expect((await collect(runner, 'const m = await import("./mod.ts"); const n = 4; m.here + n')).find(f => f.type === 'result').value).toEqual({ t: 'string', v: 'there4' })
    expect((await collect(runner, 'n * 2')).find(f => f.type === 'result').value).toEqual({ t: 'number', v: 8 })
    expect(readdirSync(directory)).toEqual(['mod.ts'])
  }, 30_000)

  test('a project session boots the app from its own install', async () => {
    runner = new Runner(await shellCommand({ directory: join(import.meta.dir, '../..') }))
    expect((await runner.ready).booted).toBe(true)
    const frames = await collect(runner, '({ app: config.app.name, model: typeof User })')
    expect(frames.find(f => f.type === 'result').value.entries).toEqual([['app', { t: 'string', v: 'TinkerBelle' }], ['model', { t: 'string', v: 'object' }]])
  }, 60_000)

  test('the same session survives the re-parse an SSH server does', async () => {
    // sshd hands the command string to the user's shell. `sh -c <string>` is that step.
    const directory = mkdtempSync(join(tmpdir(), 'tinkerbelle it\'s "quoted" $HOME-'))
    const preamble = await runnerPreamble()
    runner = new Runner({ command: ['sh', '-c', throughShell(sessionScript({ directory, boot: false }))], preamble })
    expect((await runner.ready).cwd.endsWith(directory.split('/').pop()!)).toBe(true)
    expect((await collect(runner, '6 * 7')).find(f => f.type === 'result').value).toEqual({ t: 'number', v: 42 })
  }, 30_000)

  test('an env file is exported before the session starts', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'tinkerbelle-env-'))
    writeFileSync(join(directory, '.env'), 'TINKERBELLE_TEST_VALUE="from the env file"\n')
    runner = new Runner(await shellCommand({ directory, boot: false, envFile: '.env' }))
    expect((await collect(runner, 'process.env.TINKERBELLE_TEST_VALUE')).find(f => f.type === 'result').value).toEqual({ t: 'string', v: 'from the env file' })
  }, 30_000)

  test('a missing directory fails with a message that names it', async () => {
    runner = new Runner(await shellCommand({ directory: '/nonexistent/tinkerbelle-nowhere', boot: false }))
    await expect(runner.ready).rejects.toThrow(/exit 97.*cannot enter \/nonexistent\/tinkerbelle-nowhere/)
  }, 30_000)
})

describe('transport command lines', () => {
  test('ssh never prompts and never takes a changed host key', () => {
    const args = sshArguments({ host: 'box.example', user: 'deploy', port: 2222, identityFile: '/k/id', jump: 'bastion' })
    expect(args).toEqual(['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3', '-p', '2222', '-i', '/k/id', '-o', 'IdentitiesOnly=yes', '-J', 'bastion', 'deploy@box.example'])
  })

  test('an ssh session is one remote word-safe command carrying the runner on stdin', async () => {
    const built = await sshCommand({ host: 'box', directory: '/var/www/app/current', envFile: '.env' })
    expect(built.command[0]).toBe('ssh')
    expect(built.command.at(-2)).toBe('--')
    expect(built.command.at(-1)).toMatch(/^sh -c "\$\(printf %s [A-Za-z0-9+/=]+ \| base64 -d\)"$/)
    expect(built.preamble!.length).toBeGreaterThan(1000)
  })

  test('ssh into a container or a pod wraps the same script', async () => {
    expect((await sshCommand({ host: 'box', directory: '/app', container: 'web-1' })).command.at(-1)).toMatch(/^docker exec -i 'web-1' sh -c "\$\(printf %s /)
    expect((await sshCommand({ host: 'box', directory: '/app', pod: { pod: 'api-0', namespace: 'prod' } })).command.at(-1)).toMatch(/^kubectl '--namespace' 'prod' 'exec' '-i' 'api-0' '--' 'sh' '-c' "\$\(printf %s /)
  })

  test('docker and kubectl take the script as one argument, with fixed argv', () => {
    expect(dockerArguments('web', 'SCRIPT')).toEqual(['exec', '-i', 'web', 'sh', '-c', 'SCRIPT'])
    expect(kubectlArguments({ pod: 'api-0', namespace: 'prod', container: 'app', context: 'staging', kubeconfig: '/k/config' }, 'SCRIPT'))
      .toEqual(['--kubeconfig', '/k/config', '--context', 'staging', '--namespace', 'prod', 'exec', '-i', 'api-0', '-c', 'app', '--', 'sh', '-c', 'SCRIPT'])
  })
})
