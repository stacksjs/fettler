import type { Connection } from './targets'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * Stacks boxes: the servers a project is deployed to, found without typing a
 * host or a path.
 *
 * The project already knows where it is deployed. `buddy cloud:targets --json`
 * derives each site's host, SSH user and key, app directory and env file the
 * same way `buddy deploy` does, from the project's cloud config and pinned
 * state. This asks the project and turns the answer into connections.
 */

export interface BoxTarget {
  /** `api on 203.0.113.7`, for the list. */
  title: string
  site: string
  environment: string
  hostnames: string[]
  connection: Extract<Connection, { kind: 'ssh' }>
}

interface InventorySite {
  name: string
  hosts?: Array<{ address?: string, name?: string, status?: string }>
  ssh?: { user?: string, port?: number, identityFile?: string }
  appPath?: string
  envFile?: string
  hostnames?: string[]
}

/** Turn the inventory a project reports into connections. One per host a site runs on. */
export function boxesFromInventory(inventory: { environment?: string, sites?: InventorySite[] }): BoxTarget[] {
  const targets: BoxTarget[] = []
  for (const site of inventory.sites ?? []) {
    if (!site.appPath || !site.ssh?.user)
      continue
    for (const host of site.hosts ?? []) {
      if (!host.address)
        continue
      targets.push({
        title: `${site.name} on ${host.name ?? host.address}`,
        site: site.name,
        environment: inventory.environment ?? 'production',
        hostnames: site.hostnames ?? [],
        connection: {
          kind: 'ssh',
          host: host.address,
          user: site.ssh.user,
          ...(site.ssh.port && site.ssh.port !== 22 ? { port: site.ssh.port } : {}),
          ...(site.ssh.identityFile ? { identityFile: site.ssh.identityFile } : {}),
          directory: site.appPath,
          ...(site.envFile ? { envFile: site.envFile } : {}),
        },
      })
    }
  }
  return targets
}

export class BoxesUnavailable extends Error {}

/** Ask a local Stacks project where it is deployed. */
export async function listBoxes(projectPath: string, environment = 'production', timeoutMs = 30_000): Promise<{ targets: BoxTarget[], warnings: string[] }> {
  const root = resolve(projectPath)
  const buddy = join(root, 'buddy')
  if (!existsSync(buddy))
    throw new BoxesUnavailable('Only a Stacks project knows its own deploys. Open one locally first.')
  if (!/^[\w-]+$/.test(environment))
    throw new BoxesUnavailable('The environment name is not valid.')

  const proc = Bun.spawn([buddy, 'cloud:targets', '--json', '--env', environment], { cwd: root, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
  const timer = setTimeout(() => proc.kill(), timeoutMs)
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  clearTimeout(timer)

  // The command prints log lines around the JSON; the inventory is the outermost object.
  const start = out.indexOf('{')
  const end = out.lastIndexOf('}')
  if (code !== 0 || start === -1 || end <= start) {
    const reason = `${out}\n${err}`.split('\n').map(line => line.trim()).filter(line => /needs @stacksjs\/ts-cloud|error|not found|no such/i.test(line)).pop()
    throw new BoxesUnavailable(reason?.replace(/^\[[^\]]+\]\s*[\w.]+:\s*/, '') ?? 'This project could not list its deploys.')
  }
  let inventory: { sites?: InventorySite[], warnings?: string[], environment?: string }
  try {
    inventory = JSON.parse(out.slice(start, end + 1))
  }
  catch {
    throw new BoxesUnavailable('This project\'s deploy list could not be read.')
  }
  return { targets: boxesFromInventory(inventory), warnings: Array.isArray(inventory.warnings) ? inventory.warnings.map(String) : [] }
}
