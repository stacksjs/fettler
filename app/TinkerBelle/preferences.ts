/**
 * What a person can change in Settings, and what each is when they have not.
 *
 * One list, read by the agent (which stores it), the editor window (which
 * applies it) and the Settings window (which shows it). Anything not in this
 * list is not a preference: it is dropped when it arrives.
 */

export interface Preferences {
  /** Light, dark, or whatever the system is. */
  theme: 'system' | 'light' | 'dark'
  /** What the window connects to when it opens with nothing asked of it. */
  startup: 'sandbox' | 'last' | 'nothing'
  /** Code size in the editor, in pixels. */
  fontSize: number
  /** The code's typeface: the app's own stack, or one named face with the same stack behind it. */
  codeFont: 'default' | 'sf-mono' | 'menlo' | 'jetbrains-mono' | 'fira-code'
  /** How much air a line of code gets. */
  lineHeight: 'compact' | 'normal' | 'relaxed'
  /** Spaces per indent. */
  tabSize: 2 | 4 | 8
  /** What the Tab key writes. */
  indentWith: 'spaces' | 'tabs'
  lineNumbers: boolean
  /** Say each problem after its line, not only as a squiggle. */
  inlineProblems: boolean
  /** Offer completions while typing. */
  completions: boolean
  /** Show what a word is when the pointer rests on it. */
  hover: boolean
  /** Show a call's parameters while its arguments are typed. */
  signatureHelp: boolean
  /** Open the side pane when a run has something to show. */
  openPaneOnRun: boolean
}

export const DEFAULT_PREFERENCES: Preferences = {
  theme: 'system',
  startup: 'sandbox',
  fontSize: 13,
  codeFont: 'default',
  lineHeight: 'normal',
  tabSize: 2,
  indentWith: 'spaces',
  lineNumbers: true,
  inlineProblems: true,
  completions: true,
  hover: true,
  signatureHelp: true,
  openPaneOnRun: true,
}

export const FONT_SIZE = { min: 10, max: 22 }

const CODE_FONT_FALLBACK = `'SF Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`

/** Each typeface choice as a CSS font stack. A face that is not installed falls through to the next. */
export const CODE_FONTS: Record<Preferences['codeFont'], string> = {
  'default': `'Zed Mono', 'JetBrains Mono', ${CODE_FONT_FALLBACK}`,
  'sf-mono': CODE_FONT_FALLBACK,
  'menlo': `Menlo, ${CODE_FONT_FALLBACK}`,
  'jetbrains-mono': `'JetBrains Mono', ${CODE_FONT_FALLBACK}`,
  'fira-code': `'Fira Code', ${CODE_FONT_FALLBACK}`,
}

/** A line's height as a multiple of the code size. */
export const LINE_HEIGHTS: Record<Preferences['lineHeight'], number> = { compact: 1.45, normal: 1.7, relaxed: 1.95 }

/** The editor's size and typeface as CSS variables, for the element the editor sits in. */
export function editorStyle(preferences: Pick<Preferences, 'fontSize' | 'codeFont' | 'lineHeight'>): string {
  const size = preferences.fontSize
  const line = Math.round(size * (LINE_HEIGHTS[preferences.lineHeight] ?? LINE_HEIGHTS.normal))
  return `--tb-code-size: ${size}px; --tb-code-line: ${line}px; --tb-code-font: ${CODE_FONTS[preferences.codeFont] ?? CODE_FONTS.default}`
}

/** The first of `candidates` that is one of `allowed`: what was sent, else what was stored, else the default. */
function oneOf<T extends string | number>(allowed: readonly T[], ...candidates: unknown[]): T {
  return candidates.find(candidate => (allowed as readonly unknown[]).includes(candidate)) as T
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/**
 * `changes` laid over `current`, with every value checked. A value of the
 * wrong kind keeps what was there, so a half-written or stale request cannot
 * leave a preference in a state the windows do not understand.
 */
export function mergePreferences(current: Partial<Preferences> | null | undefined, changes: unknown = {}): Preferences {
  const base = { ...DEFAULT_PREFERENCES, ...(current ?? {}) }
  const next = (changes && typeof changes === 'object' ? changes : {}) as Record<string, unknown>
  const sent = Number(next.fontSize)
  const size = next.fontSize !== undefined && Number.isFinite(sent) ? sent : Number(base.fontSize)
  return {
    theme: oneOf(['system', 'light', 'dark'] as const, next.theme, base.theme, DEFAULT_PREFERENCES.theme),
    startup: oneOf(['sandbox', 'last', 'nothing'] as const, next.startup, base.startup, DEFAULT_PREFERENCES.startup),
    fontSize: Number.isFinite(size) ? Math.min(FONT_SIZE.max, Math.max(FONT_SIZE.min, Math.round(size))) : DEFAULT_PREFERENCES.fontSize,
    codeFont: oneOf(['default', 'sf-mono', 'menlo', 'jetbrains-mono', 'fira-code'] as const, next.codeFont, base.codeFont, DEFAULT_PREFERENCES.codeFont),
    lineHeight: oneOf(['compact', 'normal', 'relaxed'] as const, next.lineHeight, base.lineHeight, DEFAULT_PREFERENCES.lineHeight),
    tabSize: oneOf([2, 4, 8] as const, Number(next.tabSize), Number(base.tabSize), DEFAULT_PREFERENCES.tabSize),
    indentWith: oneOf(['spaces', 'tabs'] as const, next.indentWith, base.indentWith, DEFAULT_PREFERENCES.indentWith),
    lineNumbers: flag(next.lineNumbers, flag(base.lineNumbers, DEFAULT_PREFERENCES.lineNumbers)),
    inlineProblems: flag(next.inlineProblems, flag(base.inlineProblems, DEFAULT_PREFERENCES.inlineProblems)),
    completions: flag(next.completions, flag(base.completions, DEFAULT_PREFERENCES.completions)),
    hover: flag(next.hover, flag(base.hover, DEFAULT_PREFERENCES.hover)),
    signatureHelp: flag(next.signatureHelp, flag(base.signatureHelp, DEFAULT_PREFERENCES.signatureHelp)),
    openPaneOnRun: flag(next.openPaneOnRun, flag(base.openPaneOnRun, DEFAULT_PREFERENCES.openPaneOnRun)),
  }
}
