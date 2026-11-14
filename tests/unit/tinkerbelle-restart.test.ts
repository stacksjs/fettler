import { afterEach, describe, expect, test } from 'bun:test'
import { openExternal, restartToFinishUpdate, shortcutKeys } from '../../resources/functions/desktop-bridge'

const scope = globalThis as { craft?: unknown }

afterEach(() => {
  delete scope.craft
})

describe('finishing an update', () => {
  test('quits the app through the shell, which is what lets the launcher start the new version', async () => {
    let quits = 0
    scope.craft = { app: { quit: async () => { quits++ } } }
    expect(await restartToFinishUpdate()).toBe(true)
    expect(quits).toBe(1)
  })

  test('says so when there is no shell to quit, so the page can ask the person to', async () => {
    expect(await restartToFinishUpdate()).toBe(false)
  })
})

describe('leaving the app', () => {
  test('a website link goes to the shell, which opens the browser', async () => {
    const opened: string[] = []
    scope.craft = { shell: { openExternal: async (url: string) => { opened.push(url) } } }
    expect(await openExternal('https://tinkerbelle.app/changelog')).toBe(true)
    expect(opened).toEqual(['https://tinkerbelle.app/changelog'])
  })

  test('anything that is not an https address is not opened', async () => {
    const opened: string[] = []
    scope.craft = { shell: { openExternal: async (url: string) => { opened.push(url) } } }
    expect(await openExternal('file:///etc/passwd')).toBe(false)
    expect(await openExternal('javascript:alert(1)')).toBe(false)
    expect(await openExternal('not an address')).toBe(false)
    expect(opened).toEqual([])
  })
})

describe('showing a shortcut', () => {
  test('a Mac gets the key signs', () => {
    expect(shortcutKeys(['mod', 'Enter'], 'MacIntel')).toEqual(['\u2318', '\u21A9'])
    expect(shortcutKeys(['alt', '\\'], 'MacIntel')).toEqual(['\u2325', '\\'])
  })

  test('everything else gets the key names', () => {
    expect(shortcutKeys(['mod', 'K'], 'Win32')).toEqual(['Ctrl', 'K'])
    expect(shortcutKeys(['mod', 'shift', 'Enter'], 'Linux x86_64')).toEqual(['Ctrl', 'Shift', 'Enter'])
  })
})
