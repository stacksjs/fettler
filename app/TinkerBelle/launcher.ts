import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { startAgent } from './agent'

/**
 * Open TinkerBelle: start the agent, then a Craft window on it.
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

// `tinkerbelle` opens the last state; `tinkerbelle <path>` opens that project.
const argument = process.argv.slice(2).find(value => !value.startsWith('-'))
const agent = await startAgent(argument ? { open: { kind: 'local', path: resolve(process.cwd(), argument) } } : {})
const craft = Bun.spawn([
  craftBinary(),
  '--url',
  agent.url,
  '--title',
  'TinkerBelle',
  '--width',
  '1280',
  '--height',
  '800',
], { stdout: 'ignore', stderr: 'inherit' })

void agent.windowReady.then(() => process.stderr.write('[tinkerbelle] window connected\n'))

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
