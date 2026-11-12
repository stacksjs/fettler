import type { Subprocess } from 'bun'
import type { TinkerFrame, TinkerSessionInfo, TinkerWireFrame } from '@stacksjs/tinker'
import { createFrameReader } from '@stacksjs/tinker'

/**
 * One running tinker session on a target, driven over its stdio.
 *
 * Every kind of target is the same thing from here: a command whose stdin
 * takes JSON requests and whose stdout gives marked frames. A local project,
 * the sandbox, `ssh -T`, `docker exec -i` and `kubectl exec -i` differ only in
 * the command line, which is why this class knows nothing about any of them.
 */

export interface RunnerCommand {
  /** The argv to spawn. */
  command: string[]
  /** Where to spawn it. A remote target's own directory is part of its command. */
  cwd?: string
  env?: Record<string, string | undefined>
  /** Bytes to write to stdin before any request: the runner itself, for a target that has none. */
  preamble?: Uint8Array
}

export type RunnerFrame = TinkerFrame | { type: 'stray', id: string, stream: 'stdout' | 'stderr', text: string }

export class RunnerExited extends Error {
  constructor(public exitCode: number | null, public stderr: string) {
    super(stderr.trim() ? `The session ended (exit ${exitCode}): ${stderr.trim().split('\n').slice(-3).join(' ')}` : `The session ended (exit ${exitCode}).`)
    this.name = 'RunnerExited'
  }
}

export class Runner {
  readonly ready: Promise<TinkerSessionInfo>
  private proc: Subprocess<'pipe', 'pipe', 'pipe'>
  private handlers = new Map<string, { onFrame: (frame: RunnerFrame) => void, done: (error?: Error) => void }>()
  private current: string | undefined
  private stderrTail = ''
  private counter = 0
  private exited = false

  constructor(readonly target: RunnerCommand) {
    this.proc = Bun.spawn(target.command, {
      cwd: target.cwd,
      env: { ...process.env, ...target.env },
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    })

    if (target.preamble) {
      this.proc.stdin.write(target.preamble)
      this.proc.stdin.flush()
    }

    let resolveReady!: (info: TinkerSessionInfo) => void
    let rejectReady!: (error: Error) => void
    this.ready = new Promise((resolve, reject) => {
      resolveReady = resolve
      rejectReady = reject
    })
    // A caller that never awaits `ready` must not turn a failed start into an unhandled rejection.
    this.ready.catch(() => {})

    void this.readStdout(resolveReady)
    void this.readStderr()
    void this.proc.exited.then((code) => {
      this.exited = true
      const error = new RunnerExited(code, this.stderrTail)
      rejectReady(error)
      for (const handler of this.handlers.values())
        handler.done(error)
      this.handlers.clear()
    })
  }

  private async readStdout(resolveReady: (info: TinkerSessionInfo) => void): Promise<void> {
    const reader = createFrameReader()
    const decoder = new TextDecoder()
    const dispatch = (items: ReturnType<typeof reader.push>): void => {
      for (const item of items) {
        if ('stray' in item) {
          this.toCurrent({ type: 'stray', id: this.current ?? '', stream: 'stdout', text: `${item.stray}\n` })
          continue
        }
        const frame = item.frame as TinkerWireFrame
        if (frame.type === 'ready') {
          resolveReady(frame.session)
          continue
        }
        if (frame.type === 'pong' || frame.type === 'protocol-error')
          continue
        const handler = this.handlers.get(frame.id)
        if (!handler)
          continue
        handler.onFrame(frame)
        if (frame.type === 'done') {
          this.handlers.delete(frame.id)
          if (this.current === frame.id)
            this.current = undefined
          handler.done()
        }
      }
    }
    for await (const chunk of this.proc.stdout)
      dispatch(reader.push(decoder.decode(chunk, { stream: true })))
    dispatch(reader.flush())
  }

  private async readStderr(): Promise<void> {
    const decoder = new TextDecoder()
    for await (const chunk of this.proc.stderr) {
      const text = decoder.decode(chunk, { stream: true })
      this.stderrTail = (this.stderrTail + text).slice(-4000)
      this.toCurrent({ type: 'stray', id: this.current ?? '', stream: 'stderr', text })
    }
  }

  private toCurrent(frame: RunnerFrame): void {
    if (this.current)
      this.handlers.get(this.current)?.onFrame(frame)
  }

  /** Evaluate a snippet. Frames arrive as they happen; resolves when the run is done. */
  run(code: string, onFrame: (frame: RunnerFrame) => void): Promise<void> {
    if (this.exited)
      return Promise.reject(new RunnerExited(this.proc.exitCode, this.stderrTail))
    const id = `r${++this.counter}`
    return new Promise((resolve, reject) => {
      this.handlers.set(id, { onFrame, done: error => error ? reject(error) : resolve() })
      this.current = id
      this.proc.stdin.write(`${JSON.stringify({ op: 'eval', id, code })}\n`)
      this.proc.stdin.flush()
    })
  }

  get running(): boolean {
    return !this.exited
  }

  stop(): void {
    if (this.exited)
      return
    try {
      this.proc.stdin.write(`${JSON.stringify({ op: 'exit' })}\n`)
      this.proc.stdin.end()
    }
    catch {
      // Already closed.
    }
    setTimeout(() => {
      if (!this.exited)
        this.proc.kill()
    }, 1500)
  }
}
