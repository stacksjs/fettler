import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

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
 * file's. Only a plain value is read from that file: an encrypted one says
 * nothing until the deploy decrypts it, so `APP_URL` stays unencrypted there.
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

/** One variable's value in `.env.production`, as written. */
function productionValue(name: string, root: string): string | undefined {
  const file = join(root, '.env.production')
  if (!existsSync(file))
    return undefined
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=\\s*(.*)$`).exec(line)
    if (match)
      return match[1]!.trim()
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
