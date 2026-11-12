/**
 * Drivers and panels: how a project teaches Fettler about itself.
 *
 * A project may add `.fettler/driver.ts`. Its default export can boot whatever
 * the project needs before code runs, put names on the global scope, and
 * describe panels: small read-only tables about the app (counts, versions,
 * which queue is in use). The file runs inside the session, on the target, so
 * it works the same for a local project, a server and a container.
 *
 * ```ts
 * // .fettler/driver.ts
 * export default {
 *   name: 'Shop',
 *   async boot() { await connectSearch() },
 *   globals: () => ({ shop: currentShop() }),
 *   panels: async () => [{
 *     title: 'Sales',
 *     sections: [{ title: 'Today', rows: [['Orders', await Order.count()]] }],
 *   }],
 * }
 * ```
 */

export interface PanelSection {
  title?: string
  rows: Array<[string, string]>
}

export interface Panel {
  title: string
  sections: PanelSection[]
}

/** Evaluated once, right after a session opens. Its result is `{ name, panels }` or null. */
export const DRIVER_BOOTSTRAP = `
await (async () => {
  const { existsSync } = await import('node:fs')
  const { join } = await import('node:path')
  const file = ['.fettler/driver.ts', '.fettler/driver.js'].map(name => join(process.cwd(), name)).find(existsSync)
  if (!file) return null
  const loaded = await import(file)
  const driver = loaded.default ?? loaded
  if (typeof driver.boot === 'function') await driver.boot()
  if (typeof driver.globals === 'function') Object.assign(globalThis, await driver.globals() ?? {})
  globalThis.__fettlerDriver = driver
  return { name: typeof driver.name === 'string' ? driver.name : '', panels: typeof driver.panels === 'function' }
})()
`

/**
 * Evaluated when the Info tab opens. A Stacks app gets a panel from its own
 * config without writing anything; a driver's panels follow it. Every value is
 * turned into a string in the session, so nothing but text crosses the pipe.
 */
export const PANELS_SNIPPET = `
await (async () => {
  const panels = []
  const text = value => value === undefined || value === null || value === '' ? 'not set' : typeof value === 'object' ? JSON.stringify(value) : String(value)
  const app = globalThis.config?.app
  if (app) {
    const c = globalThis.config
    const rows = [['Name', app.name], ['Environment', app.env], ['URL', app.url], ['Debug', app.debug], ['Timezone', app.timezone]]
    const services = [
      ['Database', c.database?.default],
      ['Cache', c.cache?.driver ?? c.cache?.default],
      ['Queue', c.queue?.default ?? c.queue?.driver],
      ['Mail', c.email?.default ?? c.email?.driver],
      ['Search', c.searchEngine?.driver],
      ['Storage', c.storage?.driver ?? c.filesystems?.default],
    ].filter(row => row[1] !== undefined)
    panels.push({ title: 'App', sections: [{ title: 'Application', rows: rows.filter(row => row[1] !== undefined).map(row => [row[0], text(row[1])]) }, ...(services.length ? [{ title: 'Services', rows: services.map(row => [row[0], text(row[1])]) }] : [])] })
  }
  panels.push({ title: 'Runtime', sections: [{ rows: [['Bun', Bun.version], ['Platform', process.platform + ' ' + process.arch], ['Directory', process.cwd()], ['Process', String(process.pid)]] }] })
  const driver = globalThis.__fettlerDriver
  if (driver && typeof driver.panels === 'function') {
    for (const panel of await driver.panels() ?? []) {
      panels.push({
        title: text(panel?.title ?? 'Panel'),
        sections: (panel?.sections ?? []).map(section => ({ ...(section?.title ? { title: text(section.title) } : {}), rows: (section?.rows ?? []).map(row => [text(row?.[0]), text(row?.[1])]) })),
      })
    }
  }
  return panels
})()
`

interface Described { t: string, [key: string]: unknown }

/** A described value back into plain data. Only what a panel can hold: objects, arrays and scalars. */
export function plain(value: Described): unknown {
  switch (value.t) {
    case 'string':
    case 'boolean':
      return value.v
    case 'number':
      return typeof value.v === 'number' ? value.v : Number(value.v)
    case 'null':
      return null
    case 'array':
      return (value.items as Described[]).map(plain)
    case 'object':
      return Object.fromEntries((value.entries as Array<[string, Described]>).map(([key, item]) => [key, plain(item)]))
    default:
      return undefined
  }
}

/** Keep only well-formed panels: a driver is someone else's code and its output is shown as it comes. */
export function toPanels(value: unknown): Panel[] {
  if (!Array.isArray(value))
    return []
  const panels: Panel[] = []
  for (const item of value.slice(0, 20)) {
    if (!item || typeof item !== 'object' || typeof (item as Panel).title !== 'string' || !Array.isArray((item as Panel).sections))
      continue
    panels.push({
      title: (item as Panel).title.slice(0, 80),
      sections: (item as Panel).sections.slice(0, 20).map(section => ({
        ...(typeof section?.title === 'string' ? { title: section.title.slice(0, 80) } : {}),
        rows: (Array.isArray(section?.rows) ? section.rows : []).slice(0, 200)
          .filter(row => Array.isArray(row) && row.length >= 2)
          .map(row => [String(row[0]).slice(0, 120), String(row[1]).slice(0, 2000)] as [string, string]),
      })),
    })
  }
  return panels
}
