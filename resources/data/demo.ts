/**
 * The fixture the hero renders: one snippet, the value it returns, and the
 * query it ran. It is an illustration built from this data, not a recording
 * of the app and not a screenshot. The names are examples.
 *
 * The snippet is tokenised here by hand so the page ships no highlighter.
 * Kinds: k keyword, f call, s string, t type or model, c comment, p plain.
 */

export type TokenKind = 'k' | 'f' | 's' | 't' | 'c' | 'p'

export interface Token {
  kind: TokenKind
  text: string
}

function line(...parts: Array<[TokenKind, string]>): Token[] {
  return parts.map(([kind, text]) => ({ kind, text }))
}

export const snippet: Token[][] = [
  line(['c', '// the newest signup from one domain']),
  line(['k', 'const'], ['p', ' user = '], ['k', 'await'], ['p', ' '], ['t', 'User']),
  line(['p', '  .'], ['f', 'where'], ['p', '('], ['s', '\'email\''], ['p', ', '], ['s', '\'like\''], ['p', ', '], ['s', '\'%@example.com\''], ['p', ')']),
  line(['p', '  .'], ['f', 'orderByDesc'], ['p', '('], ['s', '\'created_at\''], ['p', ')']),
  line(['p', '  .'], ['f', 'first'], ['p', '()']),
  line(['p', '']),
  line(['p', 'user']),
]

export interface ResultField {
  name: string
  type: string
  value: string
  /** Strings print in quotes and in the string colour. */
  string?: boolean
}

export const result = {
  model: 'User',
  table: 'users',
  fields: [
    { name: 'id', type: 'number', value: '4812' },
    { name: 'name', type: 'string', value: 'Ines Okafor', string: true },
    { name: 'email', type: 'string', value: 'ines@example.com', string: true },
    { name: 'plan', type: '\'free\' | \'pro\'', value: 'pro', string: true },
    { name: 'created_at', type: 'Date', value: '2026-11-09 14:02:37' },
  ] as ResultField[],
  relations: ['posts', 'subscription'],
}

export const query = {
  sql: 'select * from "users" where "email" like ? order by "created_at" desc limit 1',
  bindings: '[\'%@example.com\']',
  rows: 1,
  duration: '1.8 ms',
}

/** Three rows for the table-mode tile on the features page. Examples too. */
export const tableRows = [
  { id: '4812', name: 'Ines Okafor', plan: 'pro' },
  { id: '4809', name: 'Tomasz Brandt', plan: 'free' },
  { id: '4803', name: 'Mirela Quist', plan: 'pro' },
]
