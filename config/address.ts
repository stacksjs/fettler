import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { decryptValue } from '@stacksjs/env/crypto'

/**
 * Where this app lives in production, from one place: `APP_URL`.
 *
 * Everything that has to name the public address reads it here: the deploy's
 * domain, DNS and certificates (config/cloud.ts), the desktop app's update
 * feed and home page (config/desktop.ts), the site's canonical links, and the
 * license endpoint compiled into the app. Moving to another domain is changing
 * `APP_URL` in `.env.production`, deploying, and cutting a release.
 *
 * A development machine's own `APP_URL` is a `.localhost` name, which is not
 * an address anyone else can reach, so it is passed over for the production
 * file's. A deploy encrypts that file in place, so a value is read through the
 * framework's own decryption, with the key in `.env.keys` (or
 * `DOTENV_PRIVATE_KEY_PRODUCTION`). Without the key there is no address, and a
 * release says so instead of guessing.
 */

const LOCAL = /^(?:localhost|127\.0\.0\.1|\[::1\]|.*\.localhost|.*\.test)$/i

function hostOf(value: string | undefined): string | null {
  const text = (value ?? '').trim().replace(/^["']|["']$/g, '')
  if (!text || text.startsWith('encrypted:'))
    return null
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`)
    return url.hostname && !LOCAL.test(url.hostname) ? url.hostname.toLowerCase() : null
  }
  catch {
    return null
  }
}

/** The key that opens `.env.production`: the environment's on a build machine, `.env.keys` on a developer's. */
function productionKey(root: string): string | undefined {
  const name = 'DOTENV_PRIVATE_KEY_PRODUCTION'
  if (process.env[name])
    return process.env[name]
  const file = join(root, '.env.keys')
  if (!existsSync(file))
    return undefined
  const line = readFileSync(file, 'utf8').split('\n').find(entry => entry.trim().startsWith(`${name}=`))
  return line?.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '') || undefined
}

/** One variable's value in `.env.production`, decrypted when it was stored encrypted. */
function productionValue(name: string, root: string): string | undefined {
  const file = join(root, '.env.production')
  if (!existsSync(file))
    return undefined
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=\\s*(.*)$`).exec(line)
    if (!match)
      continue
    const value = match[1]!.trim().replace(/^["']|["']$/g, '')
    if (!value.startsWith('encrypted:'))
      return value
    const key = productionKey(root)
    if (!key)
      return undefined
    try {
      return decryptValue(value, key)
    }
    catch {
      return undefined
    }
  }
  return undefined
}

/** The production host name (`tinkerbelle.app`), or an empty string when no public address is configured yet. */
export function productionHost(root: string = process.cwd()): string {
  return hostOf(process.env.APP_URL) ?? hostOf(productionValue('APP_URL', root)) ?? ''
}

/** The production origin (`https://tinkerbelle.app`). Falls back to this machine when none is configured, which a release refuses. */
export function productionOrigin(root: string = process.cwd()): string {
  const host = productionHost(root)
  return host ? `https://${host}` : 'http://localhost'
}

/** Domains this app used to answer on, from `APP_FORMER_DOMAINS` (comma separated). Each one redirects to the current address. */
export function formerHosts(root: string = process.cwd()): string[] {
  const listed = process.env.APP_FORMER_DOMAINS ?? productionValue('APP_FORMER_DOMAINS', root) ?? ''
  const current = productionHost(root)
  return listed.replace(/^["']|["']$/g, '').split(',').map(entry => hostOf(entry)).filter((host): host is string => Boolean(host) && host !== current)
}
