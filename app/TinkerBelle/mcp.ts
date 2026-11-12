import type { RunnerFrame } from './runner'
import type { Store } from './store'
import type { Connection } from './targets'
import { timingSafeEqual } from 'node:crypto'

/**
 * TinkerBelle as an MCP server: an AI tool can run code where TinkerBelle can.
 *
 * Mounted on the agent, so it exists while TinkerBelle is open and reaches the
 * same connections, snippets and guard. An assistant gets a bearer token of
 * its own, separate from the window's session. Code that would run on a
 * production target is refused unless the call says, in so many words, that
 * production is intended: an assistant must not get there by default.
 */

export interface McpHost {
  /** The connection the window has open, if any. */
  current: () => { connection: Connection, environment: string } | undefined
  /** Open a connection from the recent list by its key, or the sandbox. */
  open: (key: string) => Promise<{ environment: string }>
  run: (code: string, onFrame: (frame: RunnerFrame) => void) => Promise<void>
  models: () => unknown[]
}

export const PRODUCTION = /prod|live/i

interface ToolResult {
  content: Array<{ type: 'text', text: string }>
  structuredContent?: Record<string, unknown>
  isError?: boolean
}

function text(body: string, structured?: Record<string, unknown>, isError = false): ToolResult {
  return { content: [{ type: 'text', text: body }], ...(structured ? { structuredContent: structured } : {}), ...(isError ? { isError: true } : {}) }
}

/** What a run produced, as an assistant can read it: output, probes, then the result or the error. */
export function summarizeFrames(frames: RunnerFrame[], render: (value: any) => string): { ok: boolean, text: string } {
  const lines: string[] = []
  let ok = false
  for (const frame of frames as any[]) {
    if (frame.type === 'stdout' || frame.type === 'stderr' || frame.type === 'stray')
      lines.push(frame.text.replace(/\n$/, ''))
    else if (frame.type === 'dump')
      lines.push(render(frame.value))
    else if (frame.type === 'probe')
      lines.push(`line ${frame.line + 1}: ${frame.kind === 'time' ? `${frame.ms} ms` : render(frame.value)}`)
    else if (frame.type === 'query')
      lines.push(`query (${frame.durationMs ?? '?'} ms): ${frame.sql}`)
    else if (frame.type === 'result')
      lines.push(`result (${frame.durationMs} ms):\n${render(frame.value)}`)
    else if (frame.type === 'error')
      lines.push(`error:\n${render(frame.error)}`)
    else if (frame.type === 'done')
      ok = frame.ok === true
  }
  return { ok, text: lines.join('\n').slice(0, 60_000) }
}

export function tokenMatches(header: string | null, token: string): boolean {
  const given = Buffer.from((header ?? '').replace(/^Bearer\s+/i, ''))
  const wanted = Buffer.from(token)
  return given.length === wanted.length && timingSafeEqual(given, wanted)
}

export function mcpTools(host: McpHost, store: Store, render: (value: any) => string) {
  const connectionKey = (): string | undefined => {
    const current = host.current()
    if (!current)
      return undefined
    return store.recentConnections(50).find(item => JSON.stringify(item.spec) === JSON.stringify(current.connection))?.key
  }

  return [
    {
      name: 'list_connections',
      description: 'List the places TinkerBelle can run code: the connection open in the window and the recent ones (local projects, servers, containers, pods). Use a key from here with evaluate.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      execute: () => {
        const current = host.current()
        const recent = store.recentConnections(30).map(item => ({ key: item.key, kind: item.kind, label: item.label, where: item.where ?? item.path ?? '' }))
        return text(JSON.stringify({ open: current ? { key: connectionKey() ?? null, environment: current.environment } : null, recent }, null, 2), { recent })
      },
    },
    {
      name: 'evaluate',
      description: 'Run TypeScript in a connected app, or in the sandbox, and get its output and result. The app is booted: its models, config and helpers are globals, top-level await works, and the last expression is the result. Declarations persist between calls on the same connection. Without a connection key the window\'s open connection is used.',
      inputSchema: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'The TypeScript to run.' },
          connection: { type: 'string', description: 'A key from list_connections, or "sandbox". Omit to use the open connection.' },
          confirm_production: { type: 'boolean', description: 'Must be true to run on a production target. Only set it when the person has asked for production explicitly.' },
        },
        required: ['code'],
        additionalProperties: false,
      },
      annotations: { destructiveHint: true, openWorldHint: true },
      execute: async (args: Record<string, unknown>) => {
        const code = String(args.code ?? '')
        if (!code.trim())
          return text('There is no code to run.', undefined, true)
        try {
          let environment = host.current()?.environment ?? ''
          if (typeof args.connection === 'string' && args.connection && args.connection !== connectionKey())
            environment = (await host.open(args.connection)).environment
          else if (!host.current())
            return text('Nothing is connected. Call list_connections and pass a connection key, or "sandbox".', undefined, true)

          if (PRODUCTION.test(environment) && args.confirm_production !== true)
            return text(`This connection is ${environment}. Nothing was run. Ask the person whether they want this run on production, and only then call again with confirm_production set to true.`, { refused: 'production' }, true)

          const frames: RunnerFrame[] = []
          await host.run(code, frame => frames.push(frame))
          const summary = summarizeFrames(frames, render)
          return text(summary.text || '(no output)', { ok: summary.ok, environment }, !summary.ok)
        }
        catch (error) {
          return text(error instanceof Error ? error.message : String(error), undefined, true)
        }
      },
    },
    {
      name: 'list_models',
      description: 'List the models of the connected app with their columns and relations. Names only, no data.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      execute: () => text(JSON.stringify(host.models(), null, 2)),
    },
    {
      name: 'get_snippets',
      description: 'Read the snippets saved in TinkerBelle.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      execute: () => text(JSON.stringify(store.snippets(connectionKey()).map(snippet => ({ id: snippet.id, title: snippet.title, code: snippet.code })), null, 2)),
    },
    {
      name: 'add_snippet',
      description: 'Save code as a snippet in TinkerBelle, for the open project when there is one.',
      inputSchema: {
        type: 'object',
        properties: { title: { type: 'string' }, code: { type: 'string' } },
        required: ['title', 'code'],
        additionalProperties: false,
      },
      execute: (args: Record<string, unknown>) => {
        const current = host.current()
        const snippet = store.saveSnippet({ title: String(args.title ?? ''), code: String(args.code ?? ''), connection: current && current.connection.kind !== 'sandbox' ? connectionKey() ?? null : null })
        return text(`Saved snippet ${snippet.id}: ${snippet.title}`, { id: snippet.id })
      },
    },
  ]
}
