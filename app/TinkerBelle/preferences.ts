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
  /** Spaces per indent. */
  tabSize: 2 | 4 | 8
  lineNumbers: boolean
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
  tabSize: 2,
  lineNumbers: true,
  completions: true,
  hover: true,
  signatureHelp: true,
  openPaneOnRun: true,
}

export const FONT_SIZE = { min: 10, max: 22 }

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
    tabSize: oneOf([2, 4, 8] as const, Number(next.tabSize), Number(base.tabSize), DEFAULT_PREFERENCES.tabSize),
    lineNumbers: flag(next.lineNumbers, flag(base.lineNumbers, DEFAULT_PREFERENCES.lineNumbers)),
    completions: flag(next.completions, flag(base.completions, DEFAULT_PREFERENCES.completions)),
    hover: flag(next.hover, flag(base.hover, DEFAULT_PREFERENCES.hover)),
    signatureHelp: flag(next.signatureHelp, flag(base.signatureHelp, DEFAULT_PREFERENCES.signatureHelp)),
    openPaneOnRun: flag(next.openPaneOnRun, flag(base.openPaneOnRun, DEFAULT_PREFERENCES.openPaneOnRun)),
  }
}
