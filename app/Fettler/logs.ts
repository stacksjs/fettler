import type { Connection } from './targets'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { kubectlArguments, sshArguments } from './remote'

/**
 * Following a target's logs as they are written.
 *
 * A stream, not a poll: the command stays open and each line is passed on the
 * moment it arrives. Where the lines come from depends on the target. A
 * project keeps a log file; a container and a pod have the runtime's own log
 * of what the process printed.
 */

export type LogLevel = 'debug' | 'info' | 'success' | 'warning' | 'error'

export interface LogLine {
  /** ISO time when the line carries one. */
  time?: string
  level: LogLevel
  message: string
  /** The environment or channel a text-format line names. */
  channel?: string
  /** Remaining structured fields of a JSON line. */
  context?: Record<string, unknown>
  raw: string
}

const LEVELS: Record<string, LogLevel> = {
  debug: 'debug', trace: 'debug', verbose: 'debug',
  info: 'info', notice: 'info', log: 'info',
  success: 'success',
  warn: 'warning', warning: 'warning',
  error: 'error', err: 'error', fatal: 'error', critical: 'error', alert: 'error', emergency: 'error',
}

// `[2026-11-11T21:38:50.503Z] development.INFO: Running buddy tinker`
const TEXT_LINE = /^\[(\d{4}-\d{2}-\d{2}T[\d:.]+Z?)\]\s+([\w-]+)\.([A-Z]+):\s?(.*)$/s
// eslint-disable-next-line no-control-regex
const ANSI = /\x1B\[[0-9;]*[A-Za-z]/g

/** Read one line of a log, in the JSON form production writes or the text form development does. */
export function parseLogLine(input: string): LogLine {
  const raw = input.replace(ANSI, '')
  const trimmed = raw.trim()
  if (trimmed.startsWith('{')) {
    try {
      const { level, message, msg, timestamp, time, ...context } = JSON.parse(trimmed) as Record<string, unknown>
      const text = message ?? msg
      if (typeof text === 'string' || typeof level === 'string') {
        const stamp = timestamp ?? time
        return {
          ...(typeof stamp === 'string' ? { time: stamp } : typeof stamp === 'number' ? { time: new Date(stamp).toISOString() } : {}),
          level: LEVELS[String(level ?? 'info').toLowerCase()] ?? 'info',
          message: typeof text === 'string' ? text : JSON.stringify(text ?? ''),
          ...(Object.keys(context).length ? { context } : {}),
          raw,
        }
      }
    }
    catch {
      // Not JSON after all. Read it as text.
    }
  }
  const text = TEXT_LINE.exec(trimmed)
  if (text) {
    return { time: text[1]!, channel: text[2]!, level: LEVELS[text[3]!.toLowerCase()] ?? 'info', message: text[4]!, raw }
  }
  return { level: /\b(error|exception|fatal)\b/i.test(trimmed) ? 'error' : /\bwarn(ing)?\b/i.test(trimmed) ? 'warning' : 'info', message: trimmed, raw }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll('\'', '\'\\\'\'')}'`
}

/** Where a Stacks project writes its logs: one file per day. */
export const LOG_DIRECTORY = 'storage/logs'

/** The log file written to most recently in a local project. */
export function newestLogFile(root: string): string | undefined {
  const directory = join(root, LOG_DIRECTORY)
  if (!existsSync(directory))
    return undefined
  return readdirSync(directory)
    .filter(name => name.endsWith('.log'))
    .map(name => ({ name, modified: statSync(join(directory, name)).mtimeMs }))
    .sort((left, right) => right.modified - left.modified)[0]?.name
}

export interface LogSource {
  /** `file` follows the project's log file; `runtime` follows what the container or pod printed. */
  from: 'file' | 'runtime'
  /** Lines of history to show first. */
  lines?: number
  /** The log file, relative to the project. Default: the newest file in storage/logs. */
  file?: string
}

/** The command that follows a target's log. Undefined when the target has no such log (the sandbox). */
export function logCommand(connection: Connection, source: LogSource): string[] | undefined {
  const lines = String(Math.min(Math.max(source.lines ?? 200, 0), 5000))
  if (source.file !== undefined && (source.file.includes('\n') || source.file.startsWith('-')))
    return undefined

  if (connection.kind === 'sandbox')
    return undefined
  if (connection.kind === 'local') {
    const root = resolve(connection.path)
    const file = source.file ?? (newestLogFile(root) ? join(LOG_DIRECTORY, newestLogFile(root)!) : join(LOG_DIRECTORY, 'stacks.log'))
    return ['tail', '-n', lines, '-F', join(root, file)]
  }

  const directory = connection.directory.replace(/\/$/, '')
  // On a target the newest file is chosen there, by the shell, when the follow starts.
  const tail = source.file !== undefined
    ? `tail -n ${lines} -F ${shellQuote(source.file.startsWith('/') ? source.file : `${directory}/${source.file}`)}`
    : `tail -n ${lines} -F "$(ls -t ${shellQuote(`${directory}/${LOG_DIRECTORY}`)}/*.log 2>/dev/null | head -n 1)"`

  if (connection.kind === 'docker') {
    return source.from === 'runtime'
      ? ['docker', 'logs', '--follow', '--tail', lines, connection.container]
      : ['docker', 'exec', connection.container, 'sh', '-c', tail]
  }
  if (connection.kind === 'kube') {
    if (source.from === 'runtime') {
      const base = kubectlArguments(connection, '')
      // Everything before `exec` is the cluster, namespace and config selection.
      const selection = base.slice(0, base.indexOf('exec'))
      return ['kubectl', ...selection, 'logs', '--follow', `--tail=${lines}`, connection.pod, ...(connection.container ? ['-c', connection.container] : [])]
    }
    return ['kubectl', ...kubectlArguments(connection, tail)]
  }

  // SSH: the host itself, or a container or pod reached through it.
  let remote: string
  if (connection.container) {
    remote = source.from === 'runtime'
      ? `docker logs --follow --tail ${lines} ${shellQuote(connection.container)}`
      : `docker exec ${shellQuote(connection.container)} sh -c ${shellQuote(tail)}`
  }
  else if (connection.pod) {
    const base = kubectlArguments(connection.pod, '')
    const selection = base.slice(0, base.indexOf('exec')).map(shellQuote).join(' ')
    remote = source.from === 'runtime'
      ? `kubectl ${selection} logs --follow --tail=${lines} ${shellQuote(connection.pod.pod)}${connection.pod.container ? ` -c ${shellQuote(connection.pod.container)}` : ''}`
      : `kubectl ${kubectlArguments(connection.pod, tail).map(shellQuote).join(' ')}`
  }
  else {
    remote = tail
  }
  return ['ssh', ...sshArguments(connection), '--', remote]
}

/**
 * Follow a log. Calls `onLine` for each line until `stop` is called or the
 * command ends, then resolves with how it ended.
 */
export function followLog(command: string[], onLine: (line: LogLine) => void): { stop: () => void, ended: Promise<{ code: number | null, error: string }> } {
  const proc = Bun.spawn(command, { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
  let errorTail = ''

  const pump = async (stream: ReadableStream<Uint8Array>, isError: boolean): Promise<void> => {
    const decoder = new TextDecoder()
    let pending = ''
    for await (const chunk of stream) {
      pending += decoder.decode(chunk, { stream: true })
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim())
          continue
        // `docker logs` and `kubectl logs` relay the app's stderr on theirs: those are log lines too.
        // `tail` and `ssh` only use stderr to complain.
        if (isError && (command[0] === 'tail' || command[0] === 'ssh'))
          errorTail = `${errorTail}${line}\n`.slice(-2000)
        else
          onLine(parseLogLine(line))
      }
    }
    if (pending.trim() && !isError)
      onLine(parseLogLine(pending))
  }

  const done = Promise.all([pump(proc.stdout, false), pump(proc.stderr, true), proc.exited])
  return {
    stop: () => proc.kill(),
    ended: done.then(([, , code]) => ({ code, error: errorTail.trim() })),
  }
}
