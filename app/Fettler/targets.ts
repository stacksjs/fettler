import type { KubeLocator } from './remote'
import type { RunnerCommand } from './runner'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { dockerCommand, kubeCommand, localCommand, sshCommand } from './remote'

/**
 * Where code can run, each reduced to the command that starts a session there.
 */

interface RemoteProject {
  /** The project directory on the target. Absolute. */
  directory: string
  /** A file of KEY=value lines to export first. A deployed Stacks app keeps its in `.env`. */
  envFile?: string
}

export type Connection =
  | { kind: 'sandbox' }
  | { kind: 'local', path: string }
  | ({ kind: 'ssh', host: string, user?: string, port?: number, identityFile?: string, jump?: string, container?: string, pod?: KubeLocator } & RemoteProject)
  | ({ kind: 'docker', container: string } & RemoteProject)
  | ({ kind: 'kube' } & KubeLocator & RemoteProject)

export interface ConnectionSummary {
  kind: Connection['kind']
  label: string
  path?: string
  /** Where it runs, for a remote target: `deploy@box`, a container, a pod. */
  where?: string
  /** A stable identity for history and the recent list. */
  key: string
  /** For a local project: what kind it is. */
  driver?: 'stacks' | 'bun'
}

export class ConnectionError extends Error {}

export function sandboxDirectory(): string {
  const directory = join(homedir(), '.fettler', 'sandbox')
  mkdirSync(directory, { recursive: true })
  return directory
}

const HOSTNAME = /^[\w.-]+$/
const SIMPLE_NAME = /^[\w.-]+$/
const JUMP = /^[\w.@:,-]+$/

/**
 * Refuse a remote target whose fields could be read as something else. A host
 * that starts with a dash would be taken by ssh as an option, which is how a
 * pasted "host" becomes a command run on this machine.
 */
export function validate(connection: Connection): void {
  const fail = (message: string): never => {
    throw new ConnectionError(message)
  }
  const name = (value: string | undefined, what: string): void => {
    if (value !== undefined && (!SIMPLE_NAME.test(value) || value.startsWith('-')))
      fail(`${what} may only contain letters, digits, dots, dashes and underscores.`)
  }
  if (connection.kind === 'sandbox' || connection.kind === 'local')
    return

  if (!connection.directory?.startsWith('/'))
    fail('Give the project directory on the target as an absolute path.')
  if (connection.envFile !== undefined && (connection.envFile.includes('\n') || connection.envFile.startsWith('-')))
    fail('The env file name is not valid.')

  if (connection.kind === 'ssh') {
    if (!HOSTNAME.test(connection.host) || connection.host.startsWith('-'))
      fail('The host may only contain letters, digits, dots, dashes and underscores.')
    name(connection.user, 'The user')
    if (connection.port !== undefined && (!Number.isInteger(connection.port) || connection.port < 1 || connection.port > 65535))
      fail('The port must be between 1 and 65535.')
    if (connection.jump !== undefined && (!JUMP.test(connection.jump) || connection.jump.startsWith('-')))
      fail('The jump host is not valid.')
    if (connection.identityFile !== undefined && (!connection.identityFile.startsWith('/') || connection.identityFile.includes('\n')))
      fail('Give the identity file as an absolute path.')
    name(connection.container, 'The container')
  }
  if (connection.kind === 'docker')
    name(connection.container, 'The container')

  const locator = connection.kind === 'kube' ? connection : connection.kind === 'ssh' ? connection.pod : undefined
  if (locator) {
    name(locator.pod, 'The pod')
    name(locator.namespace, 'The namespace')
    name(locator.container, 'The container')
    if (locator.context !== undefined && (locator.context.startsWith('-') || /\s/.test(locator.context)))
      fail('The context is not valid.')
    if (locator.kubeconfig !== undefined && !locator.kubeconfig.startsWith('/'))
      fail('Give the kubeconfig as an absolute path.')
  }
}

export function summarize(connection: Connection): ConnectionSummary {
  if (connection.kind === 'sandbox')
    return { kind: 'sandbox', label: 'Sandbox', key: 'sandbox' }
  if (connection.kind === 'local') {
    const path = resolve(connection.path)
    return { kind: 'local', label: path.split('/').filter(Boolean).pop() ?? path, path, key: `local:${path}`, driver: existsSync(path) ? projectKind(path) : undefined }
  }

  const label = connection.directory.replace(/\/(current|releases\/[^/]+)\/?$/, '').split('/').filter(Boolean).pop() ?? connection.directory
  if (connection.kind === 'ssh') {
    const host = `${connection.user ? `${connection.user}@` : ''}${connection.host}${connection.port ? `:${connection.port}` : ''}`
    const inside = connection.container ? ` in ${connection.container}` : connection.pod ? ` in pod ${connection.pod.pod}` : ''
    return { kind: 'ssh', label, path: connection.directory, where: `${host}${inside}`, key: `ssh:${host}${inside}:${connection.directory}` }
  }
  if (connection.kind === 'docker')
    return { kind: 'docker', label, path: connection.directory, where: connection.container, key: `docker:${connection.container}:${connection.directory}` }
  const where = `${connection.context ? `${connection.context}/` : ''}${connection.namespace ?? 'default'}/${connection.pod}`
  return { kind: 'kube', label, path: connection.directory, where, key: `kube:${where}:${connection.directory}` }
}

export async function commandFor(connection: Connection): Promise<RunnerCommand> {
  validate(connection)
  if (connection.kind === 'ssh')
    return sshCommand(connection)
  if (connection.kind === 'docker')
    return dockerCommand(connection)
  if (connection.kind === 'kube')
    return kubeCommand(connection)
  if (connection.kind === 'sandbox') {
    return {
      command: [process.execPath, join(import.meta.dir, 'sandbox-entry.ts')],
      cwd: sandboxDirectory(),
    }
  }

  const root = resolve(connection.path)
  if (!existsSync(root))
    throw new ConnectionError(`${root} does not exist.`)
  if (!existsSync(join(root, 'package.json')))
    throw new ConnectionError(`${root} is not a project: it has no package.json.`)
  return localCommand({ directory: root, boot: projectKind(root) === 'stacks', bun: projectBun(root) })
}

/** What kind of project a directory is, which decides how its session starts. */
export function projectKind(root: string): 'stacks' | 'bun' {
  const isStacks = existsSync(join(root, 'buddy'))
    && (existsSync(join(root, 'storage/framework')) || existsSync(join(root, 'config/app.ts')))
  return isStacks ? 'stacks' : 'bun'
}

/** The project's own pinned Bun when it has one, so code runs on the version the project is built for. */
export function projectBun(root: string): string {
  const pinned = join(root, 'pantry/.bin', process.platform === 'win32' ? 'bun.exe' : 'bun')
  return existsSync(pinned) ? pinned : process.execPath
}
