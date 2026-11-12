import type { RunnerCommand } from './runner'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'

/**
 * Where code can run, each reduced to the command that starts a session there.
 */

export type Connection =
  | { kind: 'sandbox' }
  | { kind: 'local', path: string }

export interface ConnectionSummary {
  kind: Connection['kind']
  label: string
  path?: string
}

/** The first framework release whose `buddy tinker` speaks the frame protocol. */
const SERVE_SINCE = [0, 75, 541]

function atLeast(version: string, floor: number[]): boolean {
  const parts = version.split('.').map(part => Number.parseInt(part, 10) || 0)
  for (const [index, wanted] of floor.entries()) {
    const have = parts[index] ?? 0
    if (have !== wanted)
      return have > wanted
  }
  return true
}

function installedTinkerVersion(root: string): string | undefined {
  for (const candidate of [
    'storage/framework/core/tinker/package.json',
    'node_modules/@stacksjs/tinker/package.json',
    'pantry/@stacksjs/tinker/package.json',
  ]) {
    const file = join(root, candidate)
    if (!existsSync(file))
      continue
    try {
      return JSON.parse(readFileSync(file, 'utf8')).version as string
    }
    catch {
      // An unreadable manifest is the same as none.
    }
  }
  return undefined
}

export class ConnectionError extends Error {}

export function sandboxDirectory(): string {
  const directory = join(homedir(), '.fettler', 'sandbox')
  mkdirSync(directory, { recursive: true })
  return directory
}

export function summarize(connection: Connection): ConnectionSummary {
  if (connection.kind === 'sandbox')
    return { kind: 'sandbox', label: 'Sandbox' }
  const path = resolve(connection.path)
  return { kind: 'local', label: path.split('/').filter(Boolean).pop() ?? path, path }
}

export function commandFor(connection: Connection): RunnerCommand {
  if (connection.kind === 'sandbox') {
    return {
      command: [process.execPath, join(import.meta.dir, 'sandbox-entry.ts')],
      cwd: sandboxDirectory(),
    }
  }

  const root = resolve(connection.path)
  if (!existsSync(root))
    throw new ConnectionError(`${root} does not exist.`)
  if (!existsSync(join(root, 'buddy')))
    throw new ConnectionError(`${root} is not a Stacks project: it has no buddy file.`)
  const version = installedTinkerVersion(root)
  if (!version)
    throw new ConnectionError(`${root} has no @stacksjs/tinker installed. Run its install first.`)
  if (!atLeast(version, SERVE_SINCE))
    throw new ConnectionError(`${root} is on Stacks ${version}. Running code in it needs ${SERVE_SINCE.join('.')} or newer: run ./buddy upgrade there.`)

  return { command: [join(root, 'buddy'), 'tinker', '--serve'], cwd: root }
}
