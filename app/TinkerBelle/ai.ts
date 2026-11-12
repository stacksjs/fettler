import type { Store } from './store'

/**
 * AI in TinkerBelle: suggestions at the cursor and an assistant that writes code
 * for the connected app.
 *
 * The person brings their own key. It is kept in the operating system's
 * keychain, never in TinkerBelle's database and never sent to the window: the
 * window is told only whether one is set. What goes to the provider is the
 * code in the editor, the question, and the names of the app's models and
 * columns. No row of data is sent.
 */

export type AiProvider = 'anthropic' | 'openai' | 'ollama'

export interface AiSettings {
  enabled: boolean
  provider: AiProvider
  /** Empty means the provider's own fast default. */
  model: string
  /** Ollama's address. Local by default. */
  host: string
  /** Offer a suggestion after a pause, not only when asked. */
  automatic: boolean
}

export const defaultAiSettings: AiSettings = { enabled: false, provider: 'anthropic', model: '', host: 'http://127.0.0.1:11434', automatic: false }

export interface SecretStore {
  get: (name: string) => Promise<string | null>
  set: (name: string, value: string) => Promise<void>
  delete: (name: string) => Promise<void>
}

const SERVICE = 'app.tinkerbelle.desktop'

/** The operating system's keychain: macOS Keychain, libsecret, Windows Credential Manager. */
export const keychain: SecretStore = {
  get: name => Bun.secrets.get({ service: SERVICE, name }),
  set: (name, value) => Bun.secrets.set({ service: SERVICE, name, value }),
  delete: async (name) => {
    await Bun.secrets.delete({ service: SERVICE, name })
  },
}

export interface ModelSummary {
  name: string
  table?: string
  attributes: string[]
  relations: Array<{ kind: string, model: string }>
}

/** The app's shape as a few lines the model can use: names only, no data. */
export function describeModels(models: ModelSummary[], limit = 40): string {
  if (!models.length)
    return ''
  const lines = models.slice(0, limit).map((model) => {
    const relations = model.relations.length ? `; relations: ${model.relations.map(relation => `${relation.kind} ${relation.model}`).join(', ')}` : ''
    return `${model.name}(${model.attributes.slice(0, 24).join(', ')})${relations}`
  })
  if (models.length > limit)
    lines.push(`and ${models.length - limit} more models`)
  return lines.join('\n')
}

export interface ChatMessage { role: 'user' | 'assistant', content: string }

interface AiModule {
  complete: (input: Record<string, unknown>, runtime: Record<string, unknown>) => Promise<{ completion: string }>
  createAIClient: (config: Record<string, unknown>) => { generate: (messages: ChatMessage[], options: Record<string, unknown>) => Promise<{ content: string }> }
}

export class AiNotReady extends Error {}

const ASSISTANT_SYSTEM = [
  'You help a developer write TypeScript to run against their Stacks application in a scratch buffer.',
  'The buffer runs in the booted app: its models, config and helpers are globals, top-level await works, and the value of the last expression is shown as the result.',
  'Answer with the code first, in one fenced ts block that can be run as it is, then at most two sentences on what it does. No preamble.',
  'Use only models, columns and relations that are listed. If what is asked needs something that is not listed, say so in one sentence and do not invent it.',
  'Code that writes or deletes must say so in a comment on its first line.',
].join('\n')

/** The first fenced block of an answer, which is the code to put in the editor. */
export function extractCode(answer: string): string | null {
  const fenced = /```(?:ts|typescript|js|javascript)?\n([\s\S]*?)```/.exec(answer)
  return fenced ? fenced[1]!.replace(/\n$/, '') : null
}

export class Assistant {
  constructor(private store: Store, private secrets: SecretStore = keychain, private load: () => Promise<AiModule> = () => import('@stacksjs/ai') as unknown as Promise<AiModule>) {}

  settings(): AiSettings {
    return { ...defaultAiSettings, ...this.store.setting<Partial<AiSettings>>('ai', {}) }
  }

  /** What the window may know: the settings and whether a key exists, never the key. */
  async status(): Promise<AiSettings & { hasKey: boolean }> {
    const settings = this.settings()
    const hasKey = settings.provider === 'ollama' ? true : Boolean(await this.secrets.get(`ai.${settings.provider}`))
    return { ...settings, hasKey }
  }

  async update(input: Partial<AiSettings> & { key?: string | null }): Promise<AiSettings & { hasKey: boolean }> {
    const next: AiSettings = { ...this.settings() }
    if (input.provider === 'anthropic' || input.provider === 'openai' || input.provider === 'ollama')
      next.provider = input.provider
    if (typeof input.enabled === 'boolean')
      next.enabled = input.enabled
    if (typeof input.automatic === 'boolean')
      next.automatic = input.automatic
    if (typeof input.model === 'string')
      next.model = input.model.trim().slice(0, 120)
    if (typeof input.host === 'string' && /^https?:\/\/[\w.:-]+\/?$/.test(input.host.trim()))
      next.host = input.host.trim()
    this.store.setSetting('ai', next)

    if (input.key === null)
      await this.secrets.delete(`ai.${next.provider}`)
    else if (typeof input.key === 'string' && input.key.trim())
      await this.secrets.set(`ai.${next.provider}`, input.key.trim())
    return this.status()
  }

  private async config(): Promise<Record<string, unknown>> {
    const settings = this.settings()
    if (!settings.enabled)
      throw new AiNotReady('AI is turned off in settings.')
    const key = settings.provider === 'ollama' ? null : await this.secrets.get(`ai.${settings.provider}`)
    if (settings.provider !== 'ollama' && !key)
      throw new AiNotReady(`Add your ${settings.provider === 'anthropic' ? 'Anthropic' : 'OpenAI'} API key in settings first.`)
    const driver = {
      ...(key ? { apiKey: key } : {}),
      ...(settings.model ? { model: settings.model } : {}),
      ...(settings.provider === 'ollama' ? { host: settings.host, baseUrl: settings.host } : {}),
    }
    return {
      default: settings.provider,
      drivers: { [settings.provider]: driver },
      completion: { enabled: true, driver: settings.provider, ...(settings.model ? { model: settings.model } : {}) },
    }
  }

  /** The continuation at the cursor, or an empty string when there is none. */
  async suggest(input: { before: string, after?: string, models?: ModelSummary[], signal?: AbortSignal }): Promise<string> {
    if (!input.before.trim())
      return ''
    const config = await this.config()
    const { complete } = await this.load()
    const context = describeModels(input.models ?? [], 12)
    const result = await complete({ before: input.before, after: input.after ?? '', kind: 'code', ...(context ? { context } : {}), ...(input.signal ? { signal: input.signal } : {}) }, { config })
    return result.completion
  }

  /** An answer to a question about the buffer, as text and the code in it. */
  async ask(input: { messages: ChatMessage[], code?: string, models?: ModelSummary[] }): Promise<{ answer: string, code: string | null }> {
    const config = await this.config()
    const { createAIClient } = await this.load()
    const shape = describeModels(input.models ?? [])
    const system = [
      ASSISTANT_SYSTEM,
      shape ? `The app's models, as Name(columns); relations:\n${shape}` : 'No models are listed for this connection.',
      input.code?.trim() ? `The buffer now holds:\n\`\`\`ts\n${input.code.slice(0, 6000)}\n\`\`\`` : 'The buffer is empty.',
    ].join('\n\n')
    const messages = input.messages.slice(-12).map(message => ({ role: message.role, content: String(message.content).slice(0, 8000) }))
    const result = await createAIClient(config).generate(messages, { system, maxTokens: 1200 })
    return { answer: result.content, code: extractCode(result.content) }
  }
}
