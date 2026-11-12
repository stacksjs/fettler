import type { Connection } from './targets'
import { join } from 'node:path'
import process from 'node:process'
import { findLanguageServer, LanguageService } from './language'
import { Runner } from './runner'
import { commandFor, ConnectionError, sandboxDirectory, summarize } from './targets'

/**
 * Fettler's local agent: the one process the window talks to.
 *
 * It serves the desktop screens and answers `/__fettler/*`, and it is where
 * everything process-shaped lives: a session on a target is a child process
 * of this one. The window holds no credentials and spawns nothing.
 *
 * Only the app's own window may call it. The launcher opens the window on a
 * URL carrying a one-time token; that request trades it for an HttpOnly
 * cookie, and every API call must carry the cookie and name this host, so a
 * page in a browser on the same machine cannot reach it.
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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
}

export async function startAgent(options: { port?: number, quiet?: boolean } = {}): Promise<AgentHandle> {
  const port = options.port ?? await freePort()
  const token = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '')
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`])

  let markWindowReady!: () => void
  const windowReady = new Promise<void>((resolve) => {
    markWindowReady = resolve
  })

  let runner: Runner | undefined
  let connection: Connection | undefined
  let language: LanguageService | undefined

  // Types come from the project the session is in; the sandbox has none of its own.
  function startLanguage(target: Connection): LanguageService | undefined {
    const project = target.kind === 'local' ? target.path : sandboxDirectory()
    const binary = findLanguageServer(project, root)
    return binary ? new LanguageService(project, binary, target.kind === 'local' ? 'app/__fettler_scratch__.ts' : 'scratch.ts') : undefined
  }

  const authorized = (request: Request): boolean => {
    const cookies = request.headers.get('cookie') ?? ''
    return cookies.split(';').some(part => part.trim() === `${COOKIE}=${token}`)
  }

  async function api(request: Request, path: string): Promise<Response> {
    if (path === '/__fettler/state' && request.method === 'GET') {
      return json({
        connection: connection ? summarize(connection) : null,
        running: Boolean(runner?.running),
        platform: process.platform,
      })
    }

    if (path === '/__fettler/connect' && request.method === 'POST') {
      const body = await request.json().catch(() => null) as Connection | null
      if (!body || (body.kind !== 'sandbox' && body.kind !== 'local') || (body.kind === 'local' && typeof body.path !== 'string'))
        return json({ error: 'Name a sandbox or a local project path.' }, 400)
      try {
        const next = new Runner(commandFor(body))
        const info = await next.ready
        runner?.stop()
        runner = next
        connection = body
        language?.stop()
        language = startLanguage(body)
        return json({ connection: summarize(body), session: info })
      }
      catch (error) {
        return json({ error: error instanceof Error ? error.message : String(error) }, error instanceof ConnectionError ? 422 : 502)
      }
    }

    if (path === '/__fettler/run' && request.method === 'POST') {
      const body = await request.json().catch(() => null) as { code?: unknown } | null
      if (!body || typeof body.code !== 'string')
        return json({ error: 'Send the code to run.' }, 400)
      if (!runner?.running)
        return json({ error: 'No session is open. Connect to a project or the sandbox first.' }, 409)

      const active = runner
      const encoder = new TextEncoder()
      // One JSON frame per line, flushed as each arrives, so output shows while the code is still running.
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const send = (frame: unknown): void => controller.enqueue(encoder.encode(`${JSON.stringify(frame)}\n`))
          active.run(body.code as string, send)
            .catch(error => send({ type: 'agent-error', message: error instanceof Error ? error.message : String(error) }))
            .finally(() => controller.close())
        },
      })
      return new Response(stream, { headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' } })
    }

    if (path === '/__fettler/language' && request.method === 'POST') {
      const body = await request.json().catch(() => null) as { op?: string, text?: unknown, line?: unknown, column?: unknown } | null
      if (!body || typeof body.text !== 'string')
        return json({ error: 'Send the buffer text.' }, 400)
      if (!language)
        return json({ available: false, items: [], diagnostics: [], hover: null })
      const at = { line: Number(body.line) || 0, column: Number(body.column) || 0 }
      try {
        if (body.op === 'complete')
          return json({ available: true, items: await language.complete(body.text, at) })
        if (body.op === 'hover')
          return json({ available: true, hover: await language.hover(body.text, at) })
        if (body.op === 'diagnostics')
          return json({ available: true, diagnostics: await language.diagnostics(body.text) })
        return json({ error: 'Unknown language request.' }, 400)
      }
      catch (error) {
        return json({ available: false, error: error instanceof Error ? error.message : String(error), items: [], diagnostics: [], hover: null })
      }
    }

    if (path === '/__fettler/disconnect' && request.method === 'POST') {
      runner?.stop()
      language?.stop()
      language = undefined
      runner = undefined
      connection = undefined
      return json({ ok: true })
    }

    return json({ error: 'Not found.' }, 404)
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

      if (url.pathname.startsWith('/__fettler/')) {
        if (!authorized(request))
          return json({ error: 'This is Fettler\'s own window only.' }, 401)
        markWindowReady()
        return api(request, url.pathname)
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

  return {
    url: `http://127.0.0.1:${port}/?session=${token}`,
    port,
    windowReady,
    stop() {
      runner?.stop()
      language?.stop()
    },
  }
}

if (import.meta.main) {
  const agent = await startAgent({ port: process.env.FETTLER_PORT ? Number(process.env.FETTLER_PORT) : undefined})
  // Printed for the launcher, and for opening the window by hand in development.
  process.stdout.write(`${agent.url}\n`)
}
