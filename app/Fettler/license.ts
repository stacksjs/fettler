import type { SecretStore } from './ai'
import type { ProFeature } from './build'
import type { Store } from './store'
import { hostname } from 'node:os'
import process from 'node:process'
import { BUILD_DATE, LICENSE_ENDPOINT, LICENSE_PUBLIC_KEYS, PRO_FEATURES, PRO_OPEN_BETA, VERSION } from './build'

/**
 * Whether Pro features are unlocked on this machine, and the license behind it.
 *
 * The rules live in the framework's license client: a token signed by the
 * site, checked against the public keys in this build, works offline, and for
 * a standard license covers the builds released while its updates ran. This
 * file is the part that is Fettler's: where the token is kept (the keychain),
 * what identifies this device, and what the app does while licenses are not
 * yet on sale.
 */

export interface Standing {
  licensed: boolean
  pro: boolean
  tier: string | null
  reason: string
  updatesUntil: string | null
  expiresAt: string | null
  lastCheckedAt: string | null
  offline: boolean
}

export interface Entitlements {
  pro: boolean
  /** Why Pro is or is not unlocked, for the app to say. */
  source: 'license' | 'beta' | 'none'
  standing: Standing | null
  version: string
  buildDate: string
}

interface LicenseClient {
  activate: (key: string, device: { id: string, name?: string, platform?: string, appVersion?: string }) => Promise<{ ok: true, standing: Standing } | { ok: false, reason: string, message: string, devices?: Array<{ name: string | null, platform: string | null, lastSeenAt: string | null }> }>
  standing: () => Promise<Standing>
  release: () => Promise<unknown>
}

type ClientFactory = (options: {
  endpoint: string
  publicKeys: Record<string, string>
  buildDate: string
  storage: { get: (name: string) => Promise<string | null>, set: (name: string, value: string) => Promise<void>, delete: (name: string) => Promise<void> }
}) => LicenseClient

export interface LicensingOptions {
  /** Replaces the framework client. For tests. */
  createClient?: ClientFactory
  publicKeys?: Record<string, string>
  endpoint?: string
  openBeta?: boolean
  buildDate?: string
}

export class ProRequired extends Error {
  constructor(public feature: ProFeature) {
    super(`${PRO_FEATURES[feature]} need a Fettler Pro license. Local projects and the sandbox are free.`)
    this.name = 'ProRequired'
  }
}

export class Licensing {
  private client: Promise<LicenseClient | null> | undefined
  private cached: { at: number, value: Entitlements } | undefined

  constructor(private store: Store, private secrets: SecretStore, private options: LicensingOptions = {}) {}

  /** A random id made once for this install. Only its hash is ever sent. */
  deviceId(): string {
    let id = this.store.setting<string>('device.id', '')
    if (!id) {
      id = crypto.randomUUID()
      this.store.setSetting('device.id', id)
    }
    return id
  }

  private keys(): Record<string, string> {
    return this.options.publicKeys ?? LICENSE_PUBLIC_KEYS
  }

  private load(): Promise<LicenseClient | null> {
    this.client ??= (async () => {
      // With no public key nothing can be verified, so there is no client to ask.
      if (Object.keys(this.keys()).length === 0)
        return null
      const create = this.options.createClient
        ?? ((await import('@stacksjs/commerce/licensing/client')) as unknown as { createLicenseClient: ClientFactory }).createLicenseClient
      return create({
        endpoint: this.options.endpoint ?? LICENSE_ENDPOINT,
        publicKeys: this.keys(),
        buildDate: this.options.buildDate ?? BUILD_DATE,
        storage: {
          get: name => this.secrets.get(`license.${name}`),
          set: (name, value) => this.secrets.set(`license.${name}`, value),
          delete: name => this.secrets.delete(`license.${name}`),
        },
      })
    })()
    return this.client
  }

  /** What the app may do. Cheap to call: the answer is kept for a minute. */
  async entitlements(fresh = false): Promise<Entitlements> {
    if (!fresh && this.cached && Date.now() - this.cached.at < 60_000)
      return this.cached.value
    const base = { version: VERSION, buildDate: this.options.buildDate ?? BUILD_DATE }
    const client = await this.load()
    let standing: Standing | null = null
    if (client) {
      try {
        standing = await client.standing()
      }
      catch {
        standing = null
      }
    }
    const openBeta = this.options.openBeta ?? PRO_OPEN_BETA
    const value: Entitlements = standing?.pro
      ? { ...base, pro: true, source: 'license', standing }
      : openBeta
        ? { ...base, pro: true, source: 'beta', standing }
        : { ...base, pro: false, source: 'none', standing }
    this.cached = { at: Date.now(), value }
    return value
  }

  /** Throws `ProRequired` unless Pro is unlocked. The one check every paid feature makes. */
  async require(feature: ProFeature): Promise<void> {
    if (!(await this.entitlements()).pro)
      throw new ProRequired(feature)
  }

  async activate(key: string): Promise<{ ok: true, entitlements: Entitlements } | { ok: false, reason: string, message: string, devices?: unknown[] }> {
    const client = await this.load()
    if (!client)
      return { ok: false, reason: 'not-open', message: 'Licenses are not on sale yet. Every feature is open during the beta.' }
    const trimmed = key.trim()
    if (!trimmed)
      return { ok: false, reason: 'empty', message: 'Enter your license key.' }
    const result = await client.activate(trimmed, { id: this.deviceId(), name: hostname(), platform: process.platform, appVersion: VERSION })
    this.cached = undefined
    if (!result.ok)
      return result
    return { ok: true, entitlements: await this.entitlements(true) }
  }

  /** Give this device's slot back, so the license can be used on another one. */
  async release(): Promise<Entitlements> {
    const client = await this.load()
    await client?.release().catch(() => {})
    this.cached = undefined
    return this.entitlements(true)
  }
}
