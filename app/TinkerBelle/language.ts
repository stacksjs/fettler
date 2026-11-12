import type { Subprocess } from 'bun'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

/**
 * Language intelligence for the scratch buffer, from the TypeScript language
 * server running in the project itself.
 *
 * The buffer is opened as a document that exists only in memory, at a path
 * inside the project's `app/` directory. That placement is the whole trick:
 * the project's own tsconfig then applies to it, so its generated
 * declarations make `User`, `config` and every other auto-imported global
 * resolve with their real types. Nothing is written to the project.
 */

export interface Position { line: number, column: number }

export interface CompletionEntry {
  label: string
  kind: string
  detail?: string
  insert?: string
  sort?: string
}

export interface SignatureHelp {
  label: string
  parameters: { label: string, documentation?: string }[]
  /** The index of the parameter being typed. */
  active: number
  documentation?: string
}

export interface Diagnostic {
  from: Position
  to: Position
  message: string
  severity: 'error' | 'warning' | 'info'
}

const COMPLETION_KINDS: Record<number, string> = {
  2: 'method', 3: 'function', 4: 'constructor', 5: 'field', 6: 'variable', 7: 'class', 8: 'interface',
  9: 'module', 10: 'property', 12: 'value', 13: 'enum', 14: 'keyword', 20: 'enum-member', 21: 'constant', 22: 'struct', 25: 'type-parameter',
}

function platformPackage(): string {
  const os = process.platform === 'win32' ? 'win32' : process.platform
  return `@typescript/typescript-${os}-${process.arch}`
}

/** The TypeScript 7 binary to use: the project's own if it has one, else the one that ships with TinkerBelle. */
export function findLanguageServer(root: string, fallbackRoot: string): string | undefined {
  const binary = process.platform === 'win32' ? 'tsc.exe' : 'tsc'
  for (const base of [root, fallbackRoot]) {
    for (const modules of ['node_modules', 'pantry']) {
      const candidate = join(base, modules, platformPackage(), 'lib', binary)
      if (existsSync(candidate))
        return candidate
    }
  }
  return undefined
}

/**
 * The names a session adds to the global scope, declared for the checker. They
 * go after the user's text so no line of theirs moves.
 */
const SESSION_GLOBALS = [
  'declare global {',
  '  /** Show a value in the output without ending the run. */',
  '  function dump(...values: unknown[]): void',
  '  /** Show a value, then stop the run. */',
  '  function dd(...values: unknown[]): never',
  '  /** Render markup or a mail so the result is shown as a page. */',
  '  const preview: {',
  '    html: (markup: string, title?: string) => unknown',
  '    mail: (name: string, variables?: Record<string, unknown>) => Promise<unknown>',
  '  }',
  '}',
  '',
].join('\n')

export class LanguageService {
  private proc: Subprocess<'pipe', 'pipe', 'pipe'>
  private nextId = 1
  private pending = new Map<number, { resolve: (value: unknown) => void, reject: (error: Error) => void }>()
  private ready: Promise<void>
  private version = 0
  private opened = false
  private text = ''
  private closed = false
  readonly uri: string

  constructor(readonly root: string, binary: string, document = 'app/__tinkerbelle_scratch__.ts') {
    this.uri = `file://${join(root, document)}`
    this.proc = Bun.spawn([binary, '--lsp', '--stdio'], { cwd: root, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' })
    void this.read()
    void this.proc.exited.then(() => {
      this.closed = true
      for (const waiting of this.pending.values())
        waiting.reject(new Error('The language server stopped.'))
      this.pending.clear()
    })
    this.ready = this.request('initialize', {
      processId: process.pid,
      rootUri: `file://${root}`,
      workspaceFolders: [{ uri: `file://${root}`, name: 'project' }],
      capabilities: {
        textDocument: {
          completion: { completionItem: { snippetSupport: false, labelDetailsSupport: true } },
          hover: { contentFormat: ['plaintext', 'markdown'] },
          signatureHelp: { signatureInformation: { documentationFormat: ['plaintext', 'markdown'], parameterInformation: { labelOffsetSupport: true }, activeParameterSupport: true } },
          diagnostic: {},
        },
      },
    }).then(() => this.notify('initialized', {}))
    this.ready.catch(() => {})
  }

  private async read(): Promise<void> {
    let buffer = Buffer.alloc(0)
    for await (const chunk of this.proc.stdout) {
      buffer = Buffer.concat([buffer, chunk])
      for (;;) {
        const header = buffer.indexOf('\r\n\r\n')
        if (header < 0)
          break
        const length = Number(/Content-Length: (\d+)/i.exec(buffer.subarray(0, header).toString())?.[1] ?? Number.NaN)
        if (Number.isNaN(length)) {
          buffer = buffer.subarray(header + 4)
          continue
        }
        if (buffer.length < header + 4 + length)
          break
        const message = JSON.parse(buffer.subarray(header + 4, header + 4 + length).toString()) as { id?: number, method?: string, result?: unknown, error?: { message: string } }
        buffer = buffer.subarray(header + 4 + length)
        if (message.id !== undefined && !message.method) {
          const waiting = this.pending.get(message.id)
          this.pending.delete(message.id)
          if (message.error)
            waiting?.reject(new Error(message.error.message))
          else
            waiting?.resolve(message.result)
        }
        else if (message.id !== undefined && message.method) {
          // A request from the server (configuration, registration). Answer it so it does not wait.
          this.send({ id: message.id, result: null })
        }
      }
    }
  }

  private send(message: Record<string, unknown>): void {
    if (this.closed)
      return
    const body = JSON.stringify({ jsonrpc: '2.0', ...message })
    this.proc.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
    this.proc.stdin.flush()
  }

  private notify(method: string, params: unknown): void {
    this.send({ method, params })
  }

  private request(method: string, params: unknown): Promise<unknown> {
    if (this.closed)
      return Promise.reject(new Error('The language server stopped.'))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.send({ id, method, params })
    })
  }

  /**
   * Make the server's copy of the buffer match. A snippet has no imports, so
   * it would be checked as a script, where top-level await is an error; the
   * trailing export makes it a module without moving any line.
   */
  private async sync(text: string): Promise<void> {
    await this.ready
    const content = `${text}\nexport {}\n${SESSION_GLOBALS}`
    if (!this.opened) {
      this.opened = true
      this.text = content
      this.notify('textDocument/didOpen', { textDocument: { uri: this.uri, languageId: 'typescript', version: ++this.version, text: content } })
    }
    else if (content !== this.text) {
      this.text = content
      this.notify('textDocument/didChange', { textDocument: { uri: this.uri, version: ++this.version }, contentChanges: [{ text: content }] })
    }
  }

  async complete(text: string, at: Position): Promise<CompletionEntry[]> {
    await this.sync(text)
    const result = await this.request('textDocument/completion', { textDocument: { uri: this.uri }, position: { line: at.line, character: at.column } }) as { items?: any[] } | any[] | null
    const items = Array.isArray(result) ? result : result?.items ?? []
    return items.slice(0, 400).map((item: any) => ({
      label: typeof item.label === 'string' ? item.label : String(item.label),
      kind: COMPLETION_KINDS[item.kind as number] ?? 'text',
      ...(item.detail ?? item.labelDetails?.description ? { detail: item.detail ?? item.labelDetails?.description } : {}),
      ...(item.insertText && item.insertText !== item.label ? { insert: item.insertText } : {}),
      ...(item.sortText ? { sort: item.sortText } : {}),
    }))
  }

  async hover(text: string, at: Position): Promise<string | null> {
    await this.sync(text)
    const result = await this.request('textDocument/hover', { textDocument: { uri: this.uri }, position: { line: at.line, character: at.column } }) as { contents?: unknown } | null
    const contents = result?.contents
    if (!contents)
      return null
    if (typeof contents === 'string')
      return contents
    if (Array.isArray(contents))
      return contents.map(part => typeof part === 'string' ? part : (part as { value?: string }).value ?? '').join('\n')
    return (contents as { value?: string }).value ?? null
  }

  /** The call the position is inside: its signature, its parameters and which one is being typed. */
  async signature(text: string, at: Position): Promise<SignatureHelp | null> {
    await this.sync(text)
    const result = await this.request('textDocument/signatureHelp', { textDocument: { uri: this.uri }, position: { line: at.line, character: at.column } }) as { signatures?: any[], activeSignature?: number, activeParameter?: number } | null
    const chosen = result?.signatures?.[result.activeSignature ?? 0]
    if (!chosen || typeof chosen.label !== 'string')
      return null
    const told = (value: unknown): string | undefined => typeof value === 'string' ? value : (value as { value?: string } | undefined)?.value
    const parameters = (chosen.parameters ?? []).map((parameter: { label: string | [number, number], documentation?: unknown }) => ({
      // A parameter is named by its text, or by where it sits in the signature's label.
      label: typeof parameter.label === 'string' ? parameter.label : chosen.label.slice(parameter.label[0], parameter.label[1]),
      ...(told(parameter.documentation) ? { documentation: told(parameter.documentation) } : {}),
    }))
    return {
      label: chosen.label,
      parameters,
      active: chosen.activeParameter ?? result?.activeParameter ?? 0,
      ...(told(chosen.documentation) ? { documentation: told(chosen.documentation) } : {}),
    }
  }

  async diagnostics(text: string): Promise<Diagnostic[]> {
    await this.sync(text)
    const result = await this.request('textDocument/diagnostic', { textDocument: { uri: this.uri } }) as { items?: any[] } | null
    const lines = text.split('\n').length
    return (result?.items ?? [])
      // The appended export line is ours, not the user's.
      .filter((item: any) => item.range.start.line < lines)
      // An unused local is the point of a scratch buffer, not a mistake in it.
      .filter((item: any) => item.code !== 6133 && item.code !== 6196)
      .map((item: any) => ({
        from: { line: item.range.start.line, column: item.range.start.character },
        to: { line: item.range.end.line, column: item.range.end.character },
        message: String(item.message),
        severity: item.severity === 1 ? 'error' : item.severity === 2 ? 'warning' : 'info',
      }))
  }

  stop(): void {
    if (this.closed)
      return
    this.closed = true
    this.proc.kill()
  }
}
