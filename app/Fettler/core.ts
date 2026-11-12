import type { ChatMessage, ModelSummary, SecretStore } from './ai'
import type { LicensingOptions } from './license'
import type { McpHost } from './mcp'
import type { Connection } from './targets'
import { join } from 'node:path'
import process from 'node:process'
import { renderValue } from '@stacksjs/tinker'
import { AiNotReady, Assistant, keychain } from './ai'
import { BoxesUnavailable, listBoxes } from './boxes'
import { DRIVER_BOOTSTRAP, PANELS_SNIPPET, plain, toPanels } from './driver'
import { findLanguageServer, LanguageService } from './language'
import { Licensing, ProRequired } from './license'
import { followLog, logCommand } from './logs'
import { mcpTools, tokenMatches } from './mcp'
import { containerWorkdir, listContainers, listKubeContexts, listKubeNamespaces, listKubePods } from './remote'
import { Runner } from './runner'
import { Store } from './store'
import { commandFor, ConnectionError, sandboxDirectory, summarize, validate } from './targets'

/**
 * Everything Fettler does, as one request handler with no server of its own.
 *
 * It answers `/__fettler/*`: sessions on targets, language intelligence,
 * logs, history, the assistant, licensing, and the MCP endpoint. Whoever
 * hosts it (the framework's desktop launcher in the app, a plain server in
 * development and in tests) owns the port, the window's session cookie and
 * the Host check. This file owns none of that, which is what lets one body of
 * code run in both.
 *
 * The one path with its own credential is `/__fettler/mcp`: a host must let
 * it through without the window's cookie, and it authenticates by bearer token.
 */

const root = join(import.meta.dir, '../..')

/** Paths a host must not put behind the window's cookie. */
export const PUBLIC_PATHS = ['/__fettler/mcp']

export interface FettlerOptions {
  storePath?: string
  secrets?: SecretStore
  licensing?: LicensingOptions
  /** The origin the host is serving on, such as `http://127.0.0.1:59273`. Asked for when needed, so it may be set after the host binds. */
  origin: () => string
}

export interface Fettler {
  /** Answer a request, or return undefined for a path that is not Fettler's (a page, an asset). */
  handle: (request: Request) => Promise<Response | undefined>
  /** Open a connection before the window asks, as `fettler <path>` does. Resolves with what went wrong, or an empty string. */
  open: (connection: Connection) => Promise<string>
  store: Store
  stop: () => void
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
}

export async function createFettler(options: FettlerOptions): Promise<Fettler> {
  const store = new Store(options.storePath)
  const secrets = options.secrets ?? keychain
  const assistant = new Assistant(store, secrets)
  const licensing = new Licensing(store, secrets, options.licensing)
  // Log follows are child processes with no end of their own. Whatever is still open when the app stops is stopped with it.
  const follows = new Set<{ stop: () => void }>()

  let runner: Runner | undefined
  let connection: Connection | undefined
  let language: LanguageService | undefined
  let environmentOf = ''
  let driverNote = ''
  let startupNote = ''
  let driverName = ''
  // The connected app's models, asked for once per connection: names for the assistant, never rows.
  let models: ModelSummary[] = []

  // Types come from the project the session is in; the sandbox has none of its own.
  function startLanguage(target: Connection): LanguageService | undefined {
    // A remote project's types are on the remote. Without a local checkout there is nothing to ask.
    if (target.kind !== 'local' && target.kind !== 'sandbox')
      return undefined
    const project = target.kind === 'local' ? target.path : sandboxDirectory()
    const binary = findLanguageServer(project, root)
    return binary ? new LanguageService(project, binary, target.kind === 'local' ? 'app/__fettler_scratch__.ts' : 'scratch.ts') : undefined
  }

  const keyOf = (target: Connection): string => summarize(target).key

  /** Start a session on a target and make it the one the window and the MCP tools use. */
  async function openConnection(target: Connection): Promise<{ info: Awaited<Runner['ready']>, environment: string }> {
    const next = new Runner(await commandFor(target))
    const info = await next.ready
    // Ask the session itself where it is: the app's own word for its environment.
    let environment = ''
    await next.run('(globalThis.config?.app?.env ?? process.env.APP_ENV ?? process.env.NODE_ENV ?? "")', (frame) => {
      const seen = frame as { type?: string, value?: { t?: string, v?: unknown } }
      if (seen.type === 'result' && seen.value?.t === 'string')
        environment = String(seen.value.v)
    }).catch(() => {})
    // The project's own driver, if it has one. A driver that fails says so and the session carries on.
    let driver: { name: string, panels: boolean } | null = null
    let driverError = ''
    await next.run(DRIVER_BOOTSTRAP, (frame) => {
      const seen = frame as { type?: string, value?: { t: string }, error?: { message?: string } }
      if (seen.type === 'result' && seen.value)
        driver = plain(seen.value as never) as { name: string, panels: boolean } | null
      if (seen.type === 'error')
        driverError = seen.error?.message ?? 'The driver failed.'
    }).catch(() => {})
    driverNote = driverError ? `.fettler/driver could not be loaded: ${driverError}` : ''
    driverName = (driver as { name: string } | null)?.name ?? ''
    runner?.stop()
    runner = next
    connection = target
    language?.stop()
    language = startLanguage(target)
    const summary = summarize(target)
    store.touchConnection({ key: summary.key, kind: summary.kind, label: summary.label, path: summary.path, where: summary.where, spec: target })
    environmentOf = environment
    models = await next.models().catch(() => [])
    if (driverNote)
      info.warnings = [...info.warnings, driverNote]
    return { info, environment }
  }

  // MCP: off until the person turns it on, and behind a token of its own.
  const mcpHost: McpHost = {
    current: () => connection ? { connection, environment: environmentOf } : undefined,
    open: async (key) => {
      if (key === 'sandbox')
        return openConnection({ kind: 'sandbox' })
      const known = store.recentConnections(50).find(item => item.key === key)
      if (!known?.spec)
        throw new ConnectionError(`No connection named ${key}. Call list_connections for the keys.`)
      if ((known.spec as Connection).kind !== 'local')
        await licensing.require('remote')
      return openConnection(known.spec as Connection)
    },
    run: (code, onFrame) => {
      if (!runner?.running)
        return Promise.reject(new Error('No session is open.'))
      const ran = connection
      let ok = false
      let durationMs: number | null = null
      return runner.run(code, (frame) => {
        const seen = frame as { type?: string, ok?: boolean, durationMs?: number }
        if (seen.type === 'done')
          ok = seen.ok === true
        if (seen.type === 'result' || seen.type === 'error')
          durationMs = seen.durationMs ?? null
        onFrame(frame)
      }).then(() => {
        if (ran)
          store.recordRun(keyOf(ran), code, ok, durationMs)
      })
    },
    models: () => models,
  }
  let mcpToken = store.setting('mcp.enabled', false) ? await secrets.get('mcp.token') : null
  const { createMCPServer } = await import('@stacksjs/ai')
  const mcp = createMCPServer({
    name: 'fettler',
    version: '0.0.0',
    instructions: 'Run TypeScript in the apps Fettler is connected to. Call list_connections first. Never set confirm_production unless the person asked for production in so many words.',
    authenticate: request => mcpToken && tokenMatches(request.headers.get('authorization'), mcpToken) ? { fettler: true } : new Response('Unauthorized', { status: 401 }),
    tools: mcpTools(mcpHost, store, renderValue) as never,
  })


  async function api(request: Request, path: string): Promise<Response> {
    if (path === '/__fettler/state' && request.method === 'GET') {
      return json({
        connection: connection ? { ...summarize(connection), environment: environmentOf } : null,
        running: Boolean(runner?.running),
        platform: process.platform,
        recent: store.recentConnections(),
        // Said once: why the project named on the command line did not open.
        note: startupNote,
      })
    }

    if (path === '/__fettler/connect' && request.method === 'POST') {
      const body = await request.json().catch(() => null) as Connection | null
      if (!body || !['sandbox', 'local', 'ssh', 'docker', 'kube'].includes(body.kind) || (body.kind === 'local' && typeof body.path !== 'string'))
        return json({ error: 'Name a sandbox, a local project, or a remote target.' }, 400)
      try {
        if (body.kind !== 'sandbox' && body.kind !== 'local')
          await licensing.require('remote')
        const opened = await openConnection(body)
        return json({ connection: { ...summarize(body), environment: opened.environment }, session: opened.info })
      }
      catch (error) {
        if (error instanceof ProRequired)
          return json({ error: error.message, needsPro: error.feature }, 402)
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
          let ok = false
          let durationMs: number | null = null
          const send = (frame: unknown): void => {
            const seen = frame as { type?: string, ok?: boolean, durationMs?: number }
            if (seen.type === 'done')
              ok = seen.ok === true
            if (seen.type === 'result' || seen.type === 'error')
              durationMs = seen.durationMs ?? null
            controller.enqueue(encoder.encode(`${JSON.stringify(frame)}\n`))
          }
          const ran = connection
          active.run(body.code as string, send)
            .then(() => {
              if (ran)
                store.recordRun(keyOf(ran), body.code as string, ok, durationMs)
            })
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
        if (body.op === 'signature')
          return json({ available: true, signature: await language.signature(body.text, at) })
        if (body.op === 'diagnostics')
          return json({ available: true, diagnostics: await language.diagnostics(body.text) })
        return json({ error: 'Unknown language request.' }, 400)
      }
      catch (error) {
        return json({ available: false, error: error instanceof Error ? error.message : String(error), items: [], diagnostics: [], hover: null })
      }
    }

    if (path === '/__fettler/boxes' && request.method === 'POST') {
      const body = await request.json().catch(() => null) as { environment?: unknown } | null
      // The project to ask: the one that is open, or the last Stacks project that was.
      const project = connection?.kind === 'local'
        ? connection.path
        : store.recentConnections(30).find(item => item.kind === 'local' && item.path)?.path
      if (!project)
        return json({ error: 'Open a Stacks project locally first. Its deploys are read from it.' }, 409)
      try {
        const listed = await listBoxes(project, typeof body?.environment === 'string' && body.environment ? body.environment : 'production')
        return json({ project, ...listed })
      }
      catch (error) {
        return json({ error: error instanceof Error ? error.message : String(error) }, error instanceof BoxesUnavailable ? 422 : 502)
      }
    }

    if (path === '/__fettler/discover' && request.method === 'POST') {
      const body = await request.json().catch(() => null) as { what?: string, ssh?: { host: string, user?: string, port?: number, identityFile?: string, jump?: string }, context?: string, namespace?: string, kubeconfig?: string, container?: string } | null
      if (!body)
        return json({ error: 'Say what to list.' }, 400)
      try {
        if (body.ssh)
          validate({ kind: 'ssh', directory: '/', ...body.ssh })
        if (body.what === 'containers')
          return json({ containers: await listContainers(body.ssh) })
        if (body.what === 'workdir' && body.container) {
          validate({ kind: 'docker', directory: '/', container: body.container })
          return json({ workdir: await containerWorkdir(body.container, body.ssh) ?? null })
        }
        const locator = { context: body.context, namespace: body.namespace, kubeconfig: body.kubeconfig }
        validate({ kind: 'kube', directory: '/', pod: 'x', ...locator })
        if (body.what === 'contexts')
          return json({ contexts: await listKubeContexts(body.kubeconfig, body.ssh) })
        if (body.what === 'namespaces')
          return json({ namespaces: await listKubeNamespaces(locator, body.ssh) })
        if (body.what === 'pods')
          return json({ pods: await listKubePods(locator, body.ssh) })
        return json({ error: 'Unknown list.' }, 400)
      }
      catch (error) {
        return json({ error: error instanceof Error ? error.message : String(error) }, error instanceof ConnectionError ? 422 : 502)
      }
    }

    if (path === '/__fettler/mcp-settings') {
      const address = `${options.origin()}/__fettler/mcp`
      if (request.method === 'GET')
        return json({ enabled: Boolean(mcpToken), address })
      if (request.method === 'POST') {
        const body = await request.json().catch(() => null) as { enabled?: unknown } | null
        if (body?.enabled === true && !(await licensing.entitlements()).pro)
          return json({ error: new ProRequired('mcp').message, needsPro: 'mcp' }, 402)
        if (body?.enabled === true) {
          // A fresh token each time it is turned on: the old one stops working, and this one is shown once.
          mcpToken = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '')
          await secrets.set('mcp.token', mcpToken)
          store.setSetting('mcp.enabled', true)
          return json({ enabled: true, address, token: mcpToken })
        }
        mcpToken = null
        await secrets.delete('mcp.token').catch(() => {})
        store.setSetting('mcp.enabled', false)
        return json({ enabled: false, address })
      }
    }

    if (path === '/__fettler/panels' && request.method === 'GET') {
      if (!runner?.running)
        return json({ error: 'Open a project first.' }, 409)
      let panels: unknown = []
      let failure = ''
      await runner.run(PANELS_SNIPPET, (frame) => {
        const seen = frame as { type?: string, value?: { t: string }, error?: { message?: string } }
        if (seen.type === 'result' && seen.value)
          panels = plain(seen.value as never)
        if (seen.type === 'error')
          failure = seen.error?.message ?? 'The panels could not be read.'
      }).catch((error) => {
        failure = error instanceof Error ? error.message : String(error)
      })
      return json({ panels: toPanels(panels), driver: driverName, ...(failure ? { error: failure } : {}) })
    }

    if (path === '/__fettler/workspace') {
      // What the window keeps between launches: its open buffers and how it looks.
      if (request.method === 'GET')
        return json({ tabs: store.setting('workspace.tabs', null), active: store.setting('workspace.active', null), ui: store.setting('workspace.ui', {}) })
      if (request.method === 'POST') {
        const body = await request.json().catch(() => null) as { tabs?: unknown, active?: unknown, ui?: unknown } | null
        if (!body)
          return json({ error: 'Nothing was sent.' }, 400)
        if (Array.isArray(body.tabs)) {
          const tabs = body.tabs.slice(0, 40)
            .filter(tab => tab && typeof tab === 'object' && typeof (tab as { code?: unknown }).code === 'string')
            .map(tab => ({ id: String((tab as { id?: unknown }).id ?? '').slice(0, 40), title: String((tab as { title?: unknown }).title ?? '').slice(0, 80), code: ((tab as { code: string }).code).slice(0, 400_000) }))
          store.setSetting('workspace.tabs', tabs)
        }
        if (typeof body.active === 'string')
          store.setSetting('workspace.active', body.active.slice(0, 40))
        if (body.ui && typeof body.ui === 'object') {
          const ui = body.ui as { theme?: unknown, fontSize?: unknown }
          store.setSetting('workspace.ui', {
            theme: ui.theme === 'light' || ui.theme === 'dark' ? ui.theme : 'system',
            fontSize: Math.min(22, Math.max(10, Number(ui.fontSize) || 13)),
          })
        }
        return json({ ok: true })
      }
    }

    if (path === '/__fettler/license') {
      if (request.method === 'GET')
        return json(await licensing.entitlements(new URL(request.url).searchParams.get('fresh') === '1'))
      if (request.method === 'POST') {
        const body = await request.json().catch(() => null) as { key?: unknown } | null
        if (!body || typeof body.key !== 'string')
          return json({ error: 'Enter your license key.' }, 400)
        const result = await licensing.activate(body.key)
        return json(result, result.ok ? 200 : result.reason === 'device-limit' ? 409 : 422)
      }
      if (request.method === 'DELETE')
        return json(await licensing.release())
    }

    if (path === '/__fettler/models' && request.method === 'GET')
      return json({ models })

    if (path === '/__fettler/ai') {
      if (request.method === 'GET')
        return json(await assistant.status())
      if (request.method === 'POST') {
        const body = await request.json().catch(() => null) as Record<string, unknown> | null
        if (!body)
          return json({ error: 'Send the settings to change.' }, 400)
        return json(await assistant.update(body))
      }
    }

    if ((path === '/__fettler/ai/suggest' || path === '/__fettler/ai/ask') && request.method === 'POST') {
      const body = await request.json().catch(() => null) as { before?: unknown, after?: unknown, messages?: unknown, code?: unknown } | null
      if (!body)
        return json({ error: 'Nothing was sent.' }, 400)
      try {
        await licensing.require('ai')
        if (path.endsWith('/suggest')) {
          if (typeof body.before !== 'string')
            return json({ error: 'Send the text before the cursor.' }, 400)
          return json({ suggestion: await assistant.suggest({ before: body.before, after: typeof body.after === 'string' ? body.after : '', models, signal: request.signal }) })
        }
        if (!Array.isArray(body.messages) || !body.messages.every(item => item && typeof item === 'object' && typeof (item as ChatMessage).content === 'string'))
          return json({ error: 'Send the conversation.' }, 400)
        return json(await assistant.ask({ messages: body.messages as ChatMessage[], code: typeof body.code === 'string' ? body.code : '', models }))
      }
      catch (error) {
        if (error instanceof ProRequired)
          return json({ error: error.message, needsPro: error.feature }, 402)
        if (error instanceof AiNotReady)
          return json({ error: error.message, notReady: true }, 409)
        return json({ error: error instanceof Error ? error.message : String(error) }, 502)
      }
    }

    if (path === '/__fettler/logs' && request.method === 'GET') {
      if (!connection)
        return json({ error: 'Open a project first.' }, 409)
      const from = new URL(request.url).searchParams.get('from') === 'runtime' ? 'runtime' : 'file'
      const command = logCommand(connection, { from, lines: 200 })
      if (!command)
        return json({ error: 'This target has no log to follow.' }, 422)
      const encoder = new TextEncoder()
      let follow: ReturnType<typeof followLog> | undefined
      // The response stays open for as long as the window reads it; closing the panel ends the follow.
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const send = (item: unknown): void => {
            try {
              controller.enqueue(encoder.encode(`${JSON.stringify(item)}\n`))
            }
            catch {
              follow?.stop()
            }
          }
          follow = followLog(command, send)
          follows.add(follow)
          void follow.ended.then(() => follows.delete(follow!))
          void follow.ended.then((ended) => {
            if (ended.error)
              send({ level: 'error', message: ended.error, raw: ended.error, ended: true })
            try {
              controller.close()
            }
            catch {
              // Already closed by the reader.
            }
          })
        },
        cancel() {
          follow?.stop()
        },
      })
      return new Response(stream, { headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' } })
    }

    if (path === '/__fettler/history') {
      const url = new URL(request.url)
      if (request.method === 'GET') {
        const everywhere = url.searchParams.get('scope') === 'all'
        return json({ entries: store.history({ connection: everywhere || !connection ? undefined : keyOf(connection), search: url.searchParams.get('search') ?? undefined, limit: 200 }) })
      }
      if (request.method === 'DELETE') {
        store.clearHistory(connection ? keyOf(connection) : undefined)
        return json({ ok: true })
      }
    }

    if (path === '/__fettler/snippets') {
      if (request.method === 'GET')
        return json({ snippets: store.snippets(connection ? keyOf(connection) : undefined) })
      if (request.method === 'POST') {
        const body = await request.json().catch(() => null) as { id?: unknown, title?: unknown, code?: unknown, scoped?: unknown } | null
        if (!body || typeof body.code !== 'string' || typeof body.title !== 'string')
          return json({ error: 'A snippet needs a title and code.' }, 400)
        return json({ snippet: store.saveSnippet({
          id: typeof body.id === 'number' ? body.id : undefined,
          title: body.title,
          code: body.code,
          connection: body.scoped === true && connection ? keyOf(connection) : null,
        }) })
      }
      if (request.method === 'DELETE') {
        const id = Number(new URL(request.url).searchParams.get('id'))
        if (!Number.isInteger(id))
          return json({ error: 'Name the snippet to delete.' }, 400)
        store.deleteSnippet(id)
        return json({ ok: true })
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

  return {
    store,
    async handle(request) {
      const path = new URL(request.url).pathname
      if (path === '/__fettler/mcp')
        return mcpToken ? mcp.handle(request) : new Response('Not found', { status: 404 })
      if (path.startsWith('/__fettler/'))
        return api(request, path)
      return undefined
    },
    async open(target) {
      let failure = ''
      await openConnection(target).catch((error) => {
        failure = error instanceof Error ? error.message : String(error)
      })
      startupNote = failure
      return failure
    },
    stop() {
      runner?.stop()
      language?.stop()
      for (const follow of follows)
        follow.stop()
      store.close()
    },
  }
}
