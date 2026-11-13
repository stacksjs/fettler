import { afterEach, describe, expect, test } from 'bun:test'
import { restartToFinishUpdate } from '../../resources/functions/desktop-bridge'

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
