import { describe, expect, test } from 'bun:test'
import { DEFAULT_PREFERENCES, mergePreferences } from '../../app/TinkerBelle/preferences'

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
})
