import { describe, expect, test } from 'bun:test'
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { boxesFromInventory, BoxesUnavailable, listBoxes } from '../../app/Fettler/boxes'
import { validate } from '../../app/Fettler/targets'

const inventory = {
  environment: 'production',
  sites: [
    { name: 'api', hosts: [{ address: '203.0.113.7', name: 'shop-production-app', status: 'running' }], ssh: { user: 'root', port: 22, identityFile: '/Users/me/.ssh/id_ed25519' }, appPath: '/var/www/shop-api/current', envFile: '/var/www/shop-api/shared/.env', hostnames: ['api.shop.test'] },
    { name: 'fleet', hosts: [{ address: '203.0.113.8' }, { address: '203.0.113.9' }], ssh: { user: 'deploy', port: 2222 }, appPath: '/var/www/shop-fleet/current' },
    { name: 'unresolved', hosts: [], ssh: { user: 'root' }, appPath: '/var/www/x/current' },
  ],
  warnings: ['Could not list servers (no token); answering from the state file.'],
}

function fakeProject(script: string): string {
  const root = mkdtempSync(join(tmpdir(), 'fettler-boxes-'))
  writeFileSync(join(root, 'buddy'), `#!/bin/sh\n${script}\n`)
  chmodSync(join(root, 'buddy'), 0o755)
  return root
}

describe('Stacks boxes', () => {
  test('each site host becomes an SSH connection with its path, key and env file', () => {
    const targets = boxesFromInventory(inventory)
    expect(targets.map(target => target.title)).toEqual(['api on shop-production-app', 'fleet on 203.0.113.8', 'fleet on 203.0.113.9'])
    expect(targets[0]!.connection).toEqual({ kind: 'ssh', host: '203.0.113.7', user: 'root', identityFile: '/Users/me/.ssh/id_ed25519', directory: '/var/www/shop-api/current', envFile: '/var/www/shop-api/shared/.env' })
    expect(targets[1]!.connection).toMatchObject({ user: 'deploy', port: 2222 })
    // What comes back must pass the same checks a typed connection does.
    for (const target of targets) expect(() => validate(target.connection)).not.toThrow()
  })

  test('asks the project, finding the inventory among its log lines', async () => {
    const root = fakeProject(`echo "[2026] development.INFO: Running buddy cloud:targets"\ncat <<'JSON'\n${JSON.stringify(inventory, null, 2)}\nJSON\necho "[2026] development.WARN: something"`)
    const listed = await listBoxes(root)
    expect(listed.targets.length).toBe(3)
    expect(listed.warnings).toEqual(inventory.warnings)
  })

  test('says why when the project cannot answer', async () => {
    const old = fakeProject('echo "[2026] development.ERROR: \\`buddy cloud:targets\\` needs @stacksjs/ts-cloud 0.16.126 or newer. Run \\`buddy upgrade\\`."; exit 1')
    await expect(listBoxes(old)).rejects.toThrow(/needs @stacksjs\/ts-cloud 0\.16\.126/)
    await expect(listBoxes(mkdtempSync(join(tmpdir(), 'fettler-nobuddy-')))).rejects.toBeInstanceOf(BoxesUnavailable)
    await expect(listBoxes(old, 'prod; rm -rf /')).rejects.toThrow(/environment name/)
  })
})
