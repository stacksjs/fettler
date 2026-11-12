import { existsSync } from 'node:fs'
import process from 'node:process'
import { startAgent } from './agent'

/**
 * Open Fettler: start the agent, then a Craft window on it.
 *
 * The window is a plain web view pointed at the agent's loopback address. It
 * is the same on macOS, Windows and Linux, which the native AppKit host is
 * not. When the window closes, the agent and every session it holds go too.
 */

function craftBinary(): string {
  const explicit = process.env.CRAFT_BIN
  if (explicit) {
    if (!existsSync(explicit))
      throw new Error(`CRAFT_BIN points at ${explicit}, which does not exist.`)
    return explicit
  }
  const found = Bun.which('craft')
  if (found)
    return found
  throw new Error('No Craft binary found. Set CRAFT_BIN to one, or install craft on the PATH.')
}

const agent = await startAgent()
const craft = Bun.spawn([
  craftBinary(),
  '--url',
  agent.url,
  '--title',
  'Fettler',
  '--width',
  '1280',
  '--height',
  '800',
], { stdout: 'ignore', stderr: 'inherit' })

void agent.windowReady.then(() => process.stderr.write('[fettler] window connected\n'))

const shutdown = (): void => {
  agent.stop()
  craft.kill()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

const code = await craft.exited
agent.stop()
process.exit(code ?? 0)
