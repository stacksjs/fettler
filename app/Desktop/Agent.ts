import type { WebviewAgentModule } from '@stacksjs/desktop-build'
import type { TinkerBelle } from '../TinkerBelle/core'
import { existsSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createTinkerBelle } from '../TinkerBelle/core'

/**
 * TinkerBelle inside the framework's desktop launcher.
 *
 * The launcher owns the port, the single instance, the window's session
 * cookie and the Host check. This module hands every request to the same
 * core the development server uses, and turns "the app was opened on a
 * folder" into an open connection.
 */

let tinkerbelle: Promise<TinkerBelle> | undefined

/** The first argument that is a directory: `tinkerbelle ./my-app`. */
function projectIn(args: string[] = [], cwd = process.cwd()): string | undefined {
  for (const argument of args) {
    if (!argument || argument.startsWith('-'))
      continue
    const path = resolve(cwd, argument)
    if (existsSync(path) && statSync(path).isDirectory())
      return path
  }
  return undefined
}

export default {
  async start({ origin, dataDir, launch }) {
    tinkerbelle = createTinkerBelle({ origin: () => origin, storePath: join(dataDir, 'tinkerbelle.sqlite') })
    const project = projectIn(launch?.args)
    if (project)
      await (await tinkerbelle).open({ kind: 'local', path: project })
  },

  async fetch(request) {
    return tinkerbelle ? (await tinkerbelle).handle(request) : undefined
  },

  // A second `tinkerbelle <path>` while the app is open: open that project in the running window.
  async secondInstance({ args, cwd }) {
    const project = projectIn(args, cwd)
    if (project && tinkerbelle)
      await (await tinkerbelle).open({ kind: 'local', path: project })
  },

  async stop() {
    if (tinkerbelle)
      (await tinkerbelle).stop()
  },
} satisfies WebviewAgentModule
