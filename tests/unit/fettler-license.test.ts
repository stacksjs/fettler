import { describe, expect, test } from 'bun:test'
import { Licensing, ProRequired } from '../../app/Fettler/license'
import { Store } from '../../app/Fettler/store'

function setup(options: { openBeta?: boolean, keys?: Record<string, string>, standing?: any, activate?: any } = {}) {
  const store = new Store(':memory:')
  const kept = new Map<string, string>()
  const secrets = {
    get: async (name: string) => kept.get(name) ?? null,
    set: async (name: string, value: string) => { kept.set(name, value) },
    delete: async (name: string) => { kept.delete(name) },
  }
  const calls: any[] = []
  let standing = options.standing ?? { licensed: false, pro: false, tier: null, reason: 'unlicensed', updatesUntil: null, expiresAt: null, lastCheckedAt: null, offline: false }
  const licensing = new Licensing(store, secrets, {
    openBeta: options.openBeta ?? false,
    publicKeys: options.keys ?? { 'license-test': 'ed25519-public:AAAA' },
    createClient: (config) => {
      calls.push({ created: config })
      return {
        standing: async () => standing,
        activate: async (key, device) => {
          calls.push({ activate: { key, device } })
          const result = options.activate ?? { ok: true, standing: { ...standing, licensed: true, pro: true, tier: 'standard', reason: 'ok' } }
          if (result.ok) standing = result.standing
          await config.storage.set('token', 'stored')
          return result
        },
        release: async () => {
          standing = { ...standing, licensed: false, pro: false, reason: 'released' }
          await config.storage.delete('token')
        },
      }
    },
  })
  return { licensing, calls, kept, store }
}

describe('entitlements', () => {
  test('with no license and no open beta, Pro is locked and every paid feature says why', async () => {
    const { licensing } = setup()
    expect(await licensing.entitlements()).toMatchObject({ pro: false, source: 'none' })
    await expect(licensing.require('remote')).rejects.toBeInstanceOf(ProRequired)
    await expect(licensing.require('ai')).rejects.toThrow(/Local projects and the sandbox are free/)
  })

  test('during the open beta Pro is unlocked, and says it is the beta, not a license', async () => {
    const { licensing } = setup({ openBeta: true })
    expect(await licensing.entitlements()).toMatchObject({ pro: true, source: 'beta' })
    await licensing.require('mcp')
  })

  test('with no public key there is nothing to verify against, so no client is made', async () => {
    const { licensing, calls } = setup({ keys: {} })
    expect(await licensing.entitlements()).toMatchObject({ pro: false, source: 'none', standing: null })
    expect(await licensing.activate('ANY-KEY')).toMatchObject({ ok: false, reason: 'not-open' })
    expect(calls).toEqual([])
  })

  test('activating unlocks Pro, sends this device, and keeps the token in the keychain', async () => {
    const { licensing, calls, kept, store } = setup()
    const result = await licensing.activate('  ABCD-EFGH  ')
    expect(result).toMatchObject({ ok: true, entitlements: { pro: true, source: 'license' } })
    const sent = calls.find(call => call.activate).activate
    expect(sent.key).toBe('ABCD-EFGH')
    expect(sent.device.id).toBe(store.setting('device.id', ''))
    expect(sent.device.id.length).toBeGreaterThan(20)
    expect(kept.get('license.token')).toBe('stored')
    await licensing.require('remote')
  })

  test('a refusal passes through with the devices in use', async () => {
    const { licensing } = setup({ activate: { ok: false, reason: 'device-limit', message: 'Two devices already use this license.', devices: [{ name: 'Studio', platform: 'darwin', lastSeenAt: null }] } })
    expect(await licensing.activate('KEY')).toEqual({ ok: false, reason: 'device-limit', message: 'Two devices already use this license.', devices: [{ name: 'Studio', platform: 'darwin', lastSeenAt: null }] })
  })

  test('releasing the device locks Pro again and removes the token', async () => {
    const { licensing, kept } = setup()
    await licensing.activate('KEY')
    expect(await licensing.release()).toMatchObject({ pro: false, source: 'none' })
    expect(kept.has('license.token')).toBe(false)
  })

  test('the device id is made once and reused', () => {
    const { licensing } = setup()
    expect(licensing.deviceId()).toBe(licensing.deviceId())
  })
})
