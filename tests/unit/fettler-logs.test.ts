import { describe, expect, test } from 'bun:test'
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { followLog, logCommand, parseLogLine } from '../../app/Fettler/logs'

describe('reading a log line', () => {
  test('the text form development writes', () => {
    expect(parseLogLine('[2026-11-11T21:38:50.503Z] development.WARNING: disk is \x1B[33mnearly\x1B[0m full')).toEqual({
      time: '2026-11-11T21:38:50.503Z',
      channel: 'development',
      level: 'warning',
      message: 'disk is nearly full',
      raw: '[2026-11-11T21:38:50.503Z] development.WARNING: disk is nearly full',
    })
  })

  test('the JSON form production writes, keeping its other fields', () => {
    const line = parseLogLine('{"level":"error","message":"payment failed","timestamp":"2026-11-11T00:00:00Z","orderId":42}')
    expect(line).toMatchObject({ level: 'error', message: 'payment failed', time: '2026-11-11T00:00:00Z', context: { orderId: 42 } })
  })

  test('anything else is a line with a guessed level', () => {
    expect(parseLogLine('Unhandled exception in worker').level).toBe('error')
    expect(parseLogLine('listening on :3000')).toMatchObject({ level: 'info', message: 'listening on :3000' })
    expect(parseLogLine('{not json').message).toBe('{not json')
  })
})

describe('where a log comes from', () => {
  test('a local project follows its file; the sandbox has none', () => {
    expect(logCommand({ kind: 'local', path: '/apps/shop' }, { from: 'file', file: 'storage/logs/app.log' })).toEqual(['tail', '-n', '200', '-F', '/apps/shop/storage/logs/app.log'])
    expect(logCommand({ kind: 'sandbox' }, { from: 'file' })).toBeUndefined()
  })

  test('a container and a pod have the runtime log or the file', () => {
    expect(logCommand({ kind: 'docker', container: 'web', directory: '/app' }, { from: 'runtime', lines: 50 })).toEqual(['docker', 'logs', '--follow', '--tail', '50', 'web'])
    expect(logCommand({ kind: 'docker', container: 'web', directory: '/app' }, { from: 'file' })).toEqual(['docker', 'exec', 'web', 'sh', '-c', 'tail -n 200 -F "$(ls -t \'/app/storage/logs\'/*.log 2>/dev/null | head -n 1)"'])
    expect(logCommand({ kind: 'kube', pod: 'api-0', namespace: 'prod', container: 'app', directory: '/app' }, { from: 'runtime' }))
      .toEqual(['kubectl', '--namespace', 'prod', 'logs', '--follow', '--tail=200', 'api-0', '-c', 'app'])
  })

  test('over SSH the follow is one quoted remote command', () => {
    const command = logCommand({ kind: 'ssh', host: 'box', user: 'root', directory: '/var/www/it\'s/current' }, { from: 'file', file: 'storage/logs/stacks.log' })!
    expect(command[0]).toBe('ssh')
    expect(command.at(-1)).toBe('tail -n 200 -F \'/var/www/it\'\\\'\'s/current/storage/logs/stacks.log\'')
    expect(logCommand({ kind: 'ssh', host: 'box', directory: '/app', container: 'web' }, { from: 'runtime' })!.at(-1)).toBe('docker logs --follow --tail 200 \'web\'')
  })

  test('a file name that could be an option is refused', () => {
    expect(logCommand({ kind: 'local', path: '/apps/shop' }, { from: 'file', file: '-rf' })).toBeUndefined()
  })
})

describe('following a file', () => {
  test('the newest dated file is followed, and lines arrive as they are appended', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fettler-logs-'))
    mkdirSync(join(root, 'storage/logs'), { recursive: true })
    writeFileSync(join(root, 'storage/logs/stacks-2026-01-01.log'), 'an older day\n')
    await Bun.sleep(20)
    const file = join(root, 'storage/logs/stacks-2026-01-02.log')
    writeFileSync(file, '[2026-01-01T00:00:00.000Z] local.INFO: old line\n')
    const seen: string[] = []
    const follow = followLog(logCommand({ kind: 'local', path: root }, { from: 'file' })!, line => seen.push(`${line.level}:${line.message}`))
    await Bun.sleep(400)
    appendFileSync(file, '[2026-01-01T00:00:01.000Z] local.ERROR: new line\n')
    const deadline = Date.now() + 5000
    while (seen.length < 2 && Date.now() < deadline)
      await Bun.sleep(50)
    follow.stop()
    await follow.ended
    expect(seen).toEqual(['info:old line', 'error:new line'])
  }, 15_000)

  test('a file that is not there ends with the reason', async () => {
    const follow = followLog(['tail', '-n', '1', '/nonexistent/fettler.log'], () => {})
    const ended = await follow.ended
    expect(ended.code).not.toBe(0)
    expect(ended.error).toContain('No such file')
  })
})
