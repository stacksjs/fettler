import { describe, expect, test } from 'bun:test'
import { CODE_FONTS, DEFAULT_PREFERENCES, editorStyle, mergePreferences } from '../../app/TinkerBelle/preferences'

describe('preferences', () => {
  test('nothing stored is the defaults', () => {
    expect(mergePreferences(null)).toEqual(DEFAULT_PREFERENCES)
  })

  test('a change is laid over what was stored, and the rest is kept', () => {
    const stored = mergePreferences(null, { theme: 'dark', fontSize: 15 })
    expect(mergePreferences(stored, { hover: false })).toEqual({ ...DEFAULT_PREFERENCES, theme: 'dark', fontSize: 15, hover: false })
  })

  test('a value of the wrong kind keeps what was there', () => {
    const stored = mergePreferences(null, { theme: 'dark', tabSize: 4, lineNumbers: false })
    expect(mergePreferences(stored, { theme: 'neon', tabSize: 3, lineNumbers: 'yes', startup: 7 })).toEqual(stored)
  })

  test('code size stays inside what the editor can draw', () => {
    expect(mergePreferences(null, { fontSize: 99 }).fontSize).toBe(22)
    expect(mergePreferences(null, { fontSize: 2 }).fontSize).toBe(10)
    expect(mergePreferences(null, { fontSize: 'big' }).fontSize).toBe(13)
  })

  test('anything that is not a preference is dropped', () => {
    expect(Object.keys(mergePreferences(null, { apiKey: 'secret', theme: 'light' })).sort()).toEqual(Object.keys(DEFAULT_PREFERENCES).sort())
  })

  test('the editor choices are kept only when they are ones the editor has', () => {
    const stored = mergePreferences(null, { codeFont: 'menlo', lineHeight: 'relaxed', indentWith: 'tabs', inlineProblems: false })
    expect(stored).toMatchObject({ codeFont: 'menlo', lineHeight: 'relaxed', indentWith: 'tabs', inlineProblems: false })
    expect(mergePreferences(stored, { codeFont: 'comic-sans', lineHeight: 'huge', indentWith: 'both', inlineProblems: 1 })).toEqual(stored)
  })

  test('the editor style carries size, line height and typeface', () => {
    expect(editorStyle({ fontSize: 13, codeFont: 'default', lineHeight: 'normal' })).toBe(`--tb-code-size: 13px; --tb-code-line: 22px; --tb-code-font: ${CODE_FONTS.default}`)
    expect(editorStyle({ fontSize: 20, codeFont: 'menlo', lineHeight: 'compact' })).toContain('--tb-code-line: 29px')
    expect(editorStyle({ fontSize: 20, codeFont: 'menlo', lineHeight: 'compact' })).toContain('--tb-code-font: Menlo,')
  })

  test('every typeface ends in a face every computer has', () => {
    for (const stack of Object.values(CODE_FONTS)) expect(stack.endsWith('monospace')).toBe(true)
  })
})
