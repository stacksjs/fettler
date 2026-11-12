import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/**
 * What Fettler remembers on this machine: what was run, saved snippets, and
 * the projects opened. One SQLite file under the user's home.
 *
 * Kept behind this small class on purpose. The agent is not yet a booted
 * Stacks app, so these are not models; when it is, the tables move to models
 * and this file is the only one that changes.
 */

export interface HistoryEntry {
  id: number
  connection: string
  code: string
  ok: boolean
  durationMs: number | null
  createdAt: string
}

export interface Snippet {
  id: number
  title: string
  code: string
  /** The project a snippet belongs to, or null for one available everywhere. */
  connection: string | null
  createdAt: string
  updatedAt: string
}

export interface RecentConnection {
  key: string
  kind: string
  label: string
  path: string | null
  lastUsedAt: string
}

const HISTORY_LIMIT = 2000

export function defaultStorePath(): string {
  return join(homedir(), '.fettler', 'fettler.sqlite')
}

export class Store {
  private db: Database

  constructor(path: string = defaultStorePath()) {
    if (path !== ':memory:')
      mkdirSync(dirname(path), { recursive: true })
    this.db = new Database(path)
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        connection TEXT NOT NULL,
        code TEXT NOT NULL,
        ok INTEGER NOT NULL,
        duration_ms REAL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS history_connection ON history (connection, id);
      CREATE TABLE IF NOT EXISTS snippets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        code TEXT NOT NULL,
        connection TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS connections (
        key TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        label TEXT NOT NULL,
        path TEXT,
        last_used_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `)
  }

  /** Record a run. Running the same code again moves it to the top instead of repeating it. */
  recordRun(connection: string, code: string, ok: boolean, durationMs: number | null): void {
    const trimmed = code.trim()
    if (!trimmed)
      return
    const now = new Date().toISOString()
    const last = this.db.query('SELECT id, code FROM history WHERE connection = ? ORDER BY id DESC LIMIT 1').get(connection) as { id: number, code: string } | null
    if (last && last.code === code)
      this.db.query('UPDATE history SET ok = ?, duration_ms = ?, created_at = ? WHERE id = ?').run(ok ? 1 : 0, durationMs, now, last.id)
    else
      this.db.query('INSERT INTO history (connection, code, ok, duration_ms, created_at) VALUES (?, ?, ?, ?, ?)').run(connection, code, ok ? 1 : 0, durationMs, now)
    this.db.query('DELETE FROM history WHERE id <= (SELECT id FROM history ORDER BY id DESC LIMIT 1 OFFSET ?)').run(HISTORY_LIMIT)
  }

  history(options: { connection?: string, search?: string, limit?: number } = {}): HistoryEntry[] {
    const where: string[] = []
    const params: Array<string | number> = []
    if (options.connection) {
      where.push('connection = ?')
      params.push(options.connection)
    }
    if (options.search) {
      where.push('code LIKE ? ESCAPE \'\\\'')
      params.push(`%${options.search.replace(/[\\%_]/g, match => `\\${match}`)}%`)
    }
    params.push(Math.min(Math.max(options.limit ?? 100, 1), 500))
    const rows = this.db.query(`SELECT id, connection, code, ok, duration_ms, created_at FROM history ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`).all(...params) as Array<Record<string, unknown>>
    return rows.map(row => ({
      id: row.id as number,
      connection: row.connection as string,
      code: row.code as string,
      ok: row.ok === 1,
      durationMs: row.duration_ms as number | null,
      createdAt: row.created_at as string,
    }))
  }

  clearHistory(connection?: string): void {
    if (connection)
      this.db.query('DELETE FROM history WHERE connection = ?').run(connection)
    else
      this.db.exec('DELETE FROM history')
  }

  saveSnippet(input: { id?: number, title: string, code: string, connection?: string | null }): Snippet {
    const now = new Date().toISOString()
    const title = input.title.trim() || 'Untitled'
    if (input.id) {
      this.db.query('UPDATE snippets SET title = ?, code = ?, connection = ?, updated_at = ? WHERE id = ?').run(title, input.code, input.connection ?? null, now, input.id)
      return this.snippet(input.id)!
    }
    const created = this.db.query('INSERT INTO snippets (title, code, connection, created_at, updated_at) VALUES (?, ?, ?, ?, ?) RETURNING id').get(title, input.code, input.connection ?? null, now, now) as { id: number }
    return this.snippet(created.id)!
  }

  private snippet(id: number): Snippet | undefined {
    const row = this.db.query('SELECT * FROM snippets WHERE id = ?').get(id) as Record<string, unknown> | null
    return row ? this.toSnippet(row) : undefined
  }

  private toSnippet(row: Record<string, unknown>): Snippet {
    return {
      id: row.id as number,
      title: row.title as string,
      code: row.code as string,
      connection: (row.connection as string | null) ?? null,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    }
  }

  /** Snippets for a project, with the ones available everywhere after them. */
  snippets(connection?: string): Snippet[] {
    const rows = connection
      ? this.db.query('SELECT * FROM snippets WHERE connection = ? OR connection IS NULL ORDER BY connection IS NULL, updated_at DESC').all(connection)
      : this.db.query('SELECT * FROM snippets ORDER BY updated_at DESC').all()
    return (rows as Array<Record<string, unknown>>).map(row => this.toSnippet(row))
  }

  deleteSnippet(id: number): void {
    this.db.query('DELETE FROM snippets WHERE id = ?').run(id)
  }

  touchConnection(connection: { key: string, kind: string, label: string, path?: string | null }): void {
    this.db.query(`
      INSERT INTO connections (key, kind, label, path, last_used_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (key) DO UPDATE SET label = excluded.label, path = excluded.path, last_used_at = excluded.last_used_at
    `).run(connection.key, connection.kind, connection.label, connection.path ?? null, new Date().toISOString())
  }

  recentConnections(limit = 12): RecentConnection[] {
    const rows = this.db.query('SELECT key, kind, label, path, last_used_at FROM connections ORDER BY last_used_at DESC LIMIT ?').all(limit) as Array<Record<string, unknown>>
    return rows.map(row => ({
      key: row.key as string,
      kind: row.kind as string,
      label: row.label as string,
      path: (row.path as string | null) ?? null,
      lastUsedAt: row.last_used_at as string,
    }))
  }

  forgetConnection(key: string): void {
    this.db.query('DELETE FROM connections WHERE key = ?').run(key)
  }

  setting<T>(key: string, fallback: T): T {
    const row = this.db.query('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | null
    if (!row)
      return fallback
    try {
      return JSON.parse(row.value) as T
    }
    catch {
      return fallback
    }
  }

  setSetting(key: string, value: unknown): void {
    this.db.query('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value))
  }

  close(): void {
    this.db.close()
  }
}
