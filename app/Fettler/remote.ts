import type { RunnerCommand } from './runner'
import { join } from 'node:path'

/**
 * Running a session somewhere this machine can only reach through a pipe: a
 * server over SSH, a container, a pod.
 *
 * Nothing is installed or written on the target. The runner itself is sent
 * down the same stdin the requests use: a small loader, passed as an argument
 * to `bun -e`, reads a length-prefixed bundle from stdin, evaluates it, and
 * hands the rest of the stream to it as the session's input. So the target
 * needs Bun and the project, and nothing else, and the protocol it speaks is
 * always the one this app was built with.
 */

/**
 * Reads `<length>\n<bundle>` from stdin, runs the bundle, serves the session.
 * Written without single quotes so it can be single-quoted in a shell script.
 */
export const STDIN_LOADER = '(async()=>{const r=Bun.stdin.stream().getReader();let b=new Uint8Array(0);const more=async()=>{const{value:v,done:d}=await r.read();if(d)return false;const n=new Uint8Array(b.length+v.length);n.set(b);n.set(v,b.length);b=n;return true};let i;while((i=b.indexOf(10))<0)if(!await more())process.exit(64);const len=+new TextDecoder().decode(b.subarray(0,i));b=b.subarray(i+1);while(b.length<len)if(!await more())process.exit(65);const code=new TextDecoder().decode(b.subarray(0,len));const rest=b.subarray(len);const f=(0,eval)(code);if(typeof f==="function")f({},require,{exports:{}},"","");const input=(async function*(){if(rest.length)yield rest;for(;;){const{value:v,done:d}=await r.read();if(d)return;yield v}})();const{ok}=await globalThis.__fettlerServe({input,boot:process.env.FETTLER_BOOT!=="0"});process.exit(ok?0:1)})()'

let bundle: Promise<Uint8Array> | undefined

/** The runner as one CommonJS file, length-prefixed, ready to be the first bytes on a target's stdin. */
export function runnerPreamble(): Promise<Uint8Array> {
  bundle ??= (async () => {
    const built = await Bun.build({
      entrypoints: [join(import.meta.dir, 'remote-runner-entry.ts')],
      target: 'bun',
      format: 'cjs',
      minify: true,
      // The framework is the target project's own install; only the session engine travels.
      external: ['@stacksjs/config', '@stacksjs/server', '@stacksjs/logging', '@stacksjs/query-builder', '@stacksjs/email'],
    })
    if (!built.success || !built.outputs[0])
      throw new Error(`The runner could not be bundled: ${built.logs.map(log => log.message).join('; ')}`)
    const code = new Uint8Array(await built.outputs[0].arrayBuffer())
    const header = new TextEncoder().encode(`${code.length}\n`)
    const preamble = new Uint8Array(header.length + code.length)
    preamble.set(header)
    preamble.set(code, header.length)
    return preamble
  })()
  return bundle
}

function shellQuote(value: string): string {
  return `'${value.replaceAll('\'', '\'\\\'\'')}'`
}

export interface RemoteSession {
  /** The project directory on the target. */
  directory: string
  /** A file of `KEY=value` lines to export first, relative to the directory. Deployed Stacks apps keep theirs in `.env`. */
  envFile?: string
  /** Boot the Stacks app. False gives a bare Bun session. */
  boot?: boolean
}

/**
 * The POSIX shell script that starts a session on a target. It finds Bun
 * where a deploy or a developer would have put it, since a non-interactive
 * shell often has a shorter PATH than a login one.
 */
export function sessionScript(session: RemoteSession): string {
  const lines = [`cd ${shellQuote(session.directory)} || { echo "fettler: cannot enter ${session.directory.replaceAll('"', '')}" >&2; exit 97; }`]
  if (session.envFile)
    lines.push(`if [ -f ${shellQuote(session.envFile)} ]; then set -a; . ${shellQuote(session.envFile.startsWith('/') ? session.envFile : `./${session.envFile}`)}; set +a; fi`)
  if (session.boot === false)
    lines.push('export FETTLER_BOOT=0')
  lines.push(
    `for candidate in ./pantry/.bin/bun "$HOME/.bun/bin/bun" /root/.bun/bin/bun /usr/local/bin/bun bun; do`,
    `  if command -v "$candidate" >/dev/null 2>&1; then exec "$candidate" -e '${STDIN_LOADER}'; fi`,
    'done',
    'echo "fettler: bun was not found on this target" >&2',
    'exit 96',
  )
  return lines.join('\n')
}

/**
 * A command line for a shell that will parse it again (what sshd hands to the
 * login shell). The script travels as base64 inside a command substitution, so
 * no quoting in it can be mangled on the way, and stdin stays free for the session.
 */
export function throughShell(script: string): string {
  return `sh -c "$(printf %s ${Buffer.from(script).toString('base64')} | base64 -d)"`
}

export interface SshTarget extends RemoteSession {
  host: string
  user?: string
  port?: number
  identityFile?: string
  /** A jump host, as ssh -J takes it. */
  jump?: string
  /** Run inside this container on the host. */
  container?: string
  /** Run inside a pod, using kubectl on the host. */
  pod?: KubeLocator
}

export interface KubeLocator {
  pod: string
  namespace?: string
  container?: string
  context?: string
  kubeconfig?: string
}

/** Options every ssh this app runs carries. Never a password prompt, never a silent new host key. */
export function sshArguments(target: Pick<SshTarget, 'host' | 'user' | 'port' | 'identityFile' | 'jump'>): string[] {
  const args = [
    '-T',
    '-o', 'BatchMode=yes',
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'ConnectTimeout=10',
    '-o', 'ServerAliveInterval=15',
    '-o', 'ServerAliveCountMax=3',
  ]
  if (target.port)
    args.push('-p', String(target.port))
  if (target.identityFile)
    args.push('-i', target.identityFile, '-o', 'IdentitiesOnly=yes')
  if (target.jump)
    args.push('-J', target.jump)
  args.push(target.user ? `${target.user}@${target.host}` : target.host)
  return args
}

export function dockerArguments(container: string, script: string): string[] {
  return ['exec', '-i', container, 'sh', '-c', script]
}

export function kubectlArguments(locator: KubeLocator, script: string): string[] {
  const args: string[] = []
  if (locator.kubeconfig)
    args.push('--kubeconfig', locator.kubeconfig)
  if (locator.context)
    args.push('--context', locator.context)
  if (locator.namespace)
    args.push('--namespace', locator.namespace)
  args.push('exec', '-i', locator.pod)
  if (locator.container)
    args.push('-c', locator.container)
  args.push('--', 'sh', '-c', script)
  return args
}

async function withPreamble(command: string[]): Promise<RunnerCommand> {
  return { command, preamble: await runnerPreamble() }
}

export function sshCommand(target: SshTarget): Promise<RunnerCommand> {
  const script = sessionScript(target)
  let remote: string
  if (target.container)
    remote = `docker exec -i ${shellQuote(target.container)} ${throughShell(script)}`
  else if (target.pod)
    remote = `kubectl ${kubectlArguments(target.pod, '').slice(0, -1).map(shellQuote).join(' ')} "$(printf %s ${Buffer.from(script).toString('base64')} | base64 -d)"`
  else
    remote = throughShell(script)
  return withPreamble(['ssh', ...sshArguments(target), '--', remote])
}

export function dockerCommand(target: RemoteSession & { container: string }): Promise<RunnerCommand> {
  return withPreamble(['docker', ...dockerArguments(target.container, sessionScript(target))])
}

export function kubeCommand(target: RemoteSession & KubeLocator): Promise<RunnerCommand> {
  return withPreamble(['kubectl', ...kubectlArguments(target, sessionScript(target))])
}

/**
 * A session in a directory on this machine, with no shell in between: Bun is
 * started directly on the loader. Used for every local project, so the
 * session engine is always this app's own, whatever the project has installed.
 */
export async function localCommand(target: { directory: string, boot: boolean, bun: string }): Promise<RunnerCommand> {
  return {
    command: [target.bun, '-e', STDIN_LOADER],
    cwd: target.directory,
    env: { FETTLER_BOOT: target.boot ? '1' : '0' },
    preamble: await runnerPreamble(),
  }
}

/** The same script through a local shell. What a container exec does, without the container: used by tests and for a local project on an older framework. */
export function shellCommand(target: RemoteSession): Promise<RunnerCommand> {
  return withPreamble(['sh', '-c', sessionScript(target)])
}

async function capture(command: string[], timeoutMs = 15_000): Promise<string> {
  const proc = Bun.spawn(command, { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
  const timer = setTimeout(() => proc.kill(), timeoutMs)
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  clearTimeout(timer)
  if (code !== 0)
    throw new Error(err.trim().split('\n').slice(-2).join(' ') || `${command[0]} exited ${code}`)
  return out
}

/** Prefix a discovery command so it runs on an SSH host instead of here. */
function over(ssh: Pick<SshTarget, 'host' | 'user' | 'port' | 'identityFile' | 'jump'> | undefined, command: string[]): string[] {
  return ssh ? ['ssh', ...sshArguments(ssh), '--', command.map(shellQuote).join(' ')] : command
}

export interface ContainerSummary { id: string, name: string, image: string, status: string, workdir?: string }

export async function listContainers(ssh?: Parameters<typeof over>[0]): Promise<ContainerSummary[]> {
  const out = await capture(over(ssh, ['docker', 'ps', '--format', '{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}']))
  return out.split('\n').filter(Boolean).map((line) => {
    const [id = '', name = '', image = '', status = ''] = line.split('\t')
    return { id, name, image, status }
  })
}

/** Where a container starts its processes, which is usually where the app lives. */
export async function containerWorkdir(container: string, ssh?: Parameters<typeof over>[0]): Promise<string | undefined> {
  const out = await capture(over(ssh, ['docker', 'inspect', '--format', '{{.Config.WorkingDir}}', container]))
  return out.trim() || undefined
}

function kubeBase(locator: Pick<KubeLocator, 'kubeconfig' | 'context'>): string[] {
  return ['kubectl', ...(locator.kubeconfig ? ['--kubeconfig', locator.kubeconfig] : []), ...(locator.context ? ['--context', locator.context] : [])]
}

export async function listKubeContexts(kubeconfig?: string, ssh?: Parameters<typeof over>[0]): Promise<string[]> {
  const out = await capture(over(ssh, [...kubeBase({ kubeconfig }), 'config', 'get-contexts', '-o', 'name']))
  return out.split('\n').filter(Boolean)
}

export async function listKubeNamespaces(locator: Pick<KubeLocator, 'kubeconfig' | 'context'>, ssh?: Parameters<typeof over>[0]): Promise<string[]> {
  const out = await capture(over(ssh, [...kubeBase(locator), 'get', 'namespaces', '-o', 'jsonpath={range .items[*]}{.metadata.name}{"\\n"}{end}']))
  return out.split('\n').filter(Boolean)
}

export interface PodSummary { name: string, phase: string, containers: string[] }

export async function listKubePods(locator: Pick<KubeLocator, 'kubeconfig' | 'context' | 'namespace'>, ssh?: Parameters<typeof over>[0]): Promise<PodSummary[]> {
  const out = await capture(over(ssh, [
    ...kubeBase(locator),
    ...(locator.namespace ? ['--namespace', locator.namespace] : []),
    'get',
    'pods',
    '-o',
    'jsonpath={range .items[*]}{.metadata.name}{"\\t"}{.status.phase}{"\\t"}{range .spec.containers[*]}{.name}{","}{end}{"\\n"}{end}',
  ]))
  return out.split('\n').filter(Boolean).map((line) => {
    const [name = '', phase = '', containers = ''] = line.split('\t')
    return { name, phase, containers: containers.split(',').filter(Boolean) }
  })
}
