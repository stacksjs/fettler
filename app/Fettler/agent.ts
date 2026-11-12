import type { SecretStore } from './ai'
import type { LicensingOptions } from './license'
import type { Connection } from './targets'
import { join } from 'node:path'
import process from 'node:process'
import { createFettler, PUBLIC_PATHS } from './core'

/**
 * Fettler on a plain local server: what `bun run desktop` and the tests use.
 *
 * The packaged app is hosted by the framework's desktop launcher instead
 * (`app/Desktop/Agent.ts`), which brings the same guarantees this file gives
 * by hand: the server answers only its own host, the window trades a one-time
 * token for an HttpOnly cookie, and every request after that must carry it.
 * Everything the app does is in `core.ts`; this is only the door.
 */

const COOKIE = 'fettler_session'
const root = join(import.meta.dir, '../..')

export interface AgentHandle {
  url: string
  port: number
  /** Resolves when the window has made its first authorized call. */
  windowReady: Promise<void>
  stop: () => void
}

async function freePort(): Promise<number> {
  const probe = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data() {} } })
  const port = probe.port
  probe.stop(true)
  return port
}

async function portIsFree(port: number): Promise<boolean> {
  try {
    const probe = Bun.listen({ hostname: '127.0.0.1', port, socket: { data() {} } })
    probe.stop(true)
    return true
  }
  catch {
    return false
  }
}

export async function startAgent(options: { port?: number, quiet?: boolean, storePath?: string, secrets?: SecretStore, open?: Connection, licensing?: LicensingOptions } = {}): Promise<AgentHandle> {
  let port = 0
  const fettler = await createFettler({ storePath: options.storePath, secrets: options.secrets, licensing: options.licensing, origin: () => `http://127.0.0.1:${port}` })

  // The same port every launch when it is free, so an MCP client's saved address keeps working.
  const remembered = fettler.store.setting<number>('agent.port', 0)
  port = options.port ?? (remembered && await portIsFree(remembered) ? remembered : await freePort())
  fettler.store.setSetting('agent.port', port)
  const token = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '')
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`])

  let markWindowReady!: () => void
  const windowReady = new Promise<void>((resolve) => {
    markWindowReady = resolve
  })

  const authorized = (request: Request): boolean => {
    const cookies = request.headers.get('cookie') ?? ''
    return cookies.split(';').some(part => part.trim() === `${COOKIE}=${token}`)
  }

  const { serve } = await import('bun-plugin-stx/serve')
  // serve() keeps the process alive and does not resolve; it is not awaited.
  void serve({
    patterns: [join(root, 'resources/desktop')],
    port,
    // The component library answers first here. The framework's defaults
    // ship dashboard components under some of the same names (its own
    // CodeEditor among them), and a desktop screen wants the library's.
    componentsDir: join(root, 'node_modules/@stacksjs/components/src/ui'),
    additionalComponentsDirs: [join(root, 'resources/desktop/components')],
    quiet: options.quiet !== false,
    onRequest: async (request: Request) => {
      const url = new URL(request.url)
      if (!hosts.has(request.headers.get('host') ?? ''))
        return new Response('Forbidden', { status: 403 })

      // The window's first request: trade the one-time token for the cookie.
      if (url.searchParams.get('session') === token) {
        url.searchParams.delete('session')
        return new Response(null, {
          status: 302,
          headers: {
            'location': `${url.pathname}${url.search}`,
            'set-cookie': `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict`,
          },
        })
      }

      // An AI tool's door has its own bearer token: the window's cookie does not open it.
      if (PUBLIC_PATHS.includes(url.pathname))
        return fettler.handle(request)

      if (url.pathname.startsWith('/__fettler/')) {
        if (!authorized(request))
          return new Response(JSON.stringify({ error: 'This is Fettler\'s own window only.' }), { status: 401, headers: { 'content-type': 'application/json' } })
        markWindowReady()
        return fettler.handle(request)
      }

      // Pages too: nothing here is for another program to read.
      if (!authorized(request) && !url.pathname.startsWith('/_stx/') && !url.pathname.startsWith('/assets/'))
        return new Response('Open Fettler to use this.', { status: 401 })

      return undefined
    },
  } as Parameters<typeof serve>[0])

  // serve() binds asynchronously. Wait until it answers before handing out the URL.
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      await fetch(`http://127.0.0.1:${port}/__fettler/state`)
      break
    }
    catch {
      await Bun.sleep(50)
    }
  }

  // Started with a project to open (`fettler ./my-app`): connect before the window asks.
  if (options.open)
    await fettler.open(options.open)

  return {
    url: `http://127.0.0.1:${port}/?session=${token}`,
    port,
    windowReady,
    stop: () => fettler.stop(),
  }
}

if (import.meta.main) {
  const agent = await startAgent({ port: process.env.FETTLER_PORT ? Number(process.env.FETTLER_PORT) : undefined })
  // Printed for the launcher, and for opening the window by hand in development.
  process.stdout.write(`${agent.url}\n`)
}
