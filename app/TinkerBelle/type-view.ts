import { originalOffset, SETTLE_TYPE_WRAP, settledOffset, settleTopLevel } from '@stacksjs/tinker'

/**
 * The buffer as the type checker should read it.
 *
 * A session waits for a promise at the top level of a snippet, so
 * `const order = Order.create(data)` followed by `order.total` runs. The
 * checker knows nothing of that: it would type `order` as a promise and
 * underline `.total`. So the checker is not shown the buffer as typed. It is
 * shown the same rewrite the session runs, in a form that only changes types:
 * each expression the session would wait for is wrapped in `__tinkerSettled()`,
 * declared as "a promise's value, or the value itself".
 *
 * The rewrite only inserts text and never moves a line, so a position maps
 * across by its column alone. `toView` takes a position the editor sent to
 * where it is in the checked text; `toSource` takes one the checker reported
 * back to where the user sees it.
 */

export interface TextPosition { line: number, column: number }

export interface TypeView {
  /** The text to hand the language server. */
  text: string
  toView: (position: TextPosition) => TextPosition
  toSource: (position: TextPosition) => TextPosition
}

/** Declared after the user's text, inside the `declare global` the session's names share. */
export const SETTLED_DECLARATION = '  function __tinkerSettled<T>(value: T | Promise<T>): T'

function lineStarts(text: string): number[] {
  const starts = [0]
  for (let index = 0; index < text.length; index++) {
    if (text.charCodeAt(index) === 10)
      starts.push(index + 1)
  }
  return starts
}

function offsetAt(starts: number[], length: number, position: TextPosition): number {
  const line = Math.min(Math.max(position.line, 0), starts.length - 1)
  const end = line + 1 < starts.length ? starts[line + 1]! - 1 : length
  return Math.min(starts[line]! + Math.max(position.column, 0), end)
}

function positionAt(starts: number[], offset: number): TextPosition {
  let low = 0
  let high = starts.length - 1
  while (low < high) {
    const middle = (low + high + 1) >> 1
    if (starts[middle]! <= offset)
      low = middle
    else
      high = middle - 1
  }
  return { line: low, column: offset - starts[low]! }
}

/** Insert `edits` into `text`. They are sorted, and each `at` is an offset in `text`. */
function apply(text: string, edits: ReadonlyArray<{ at: number, text: string }>): string {
  let out = ''
  let cursor = 0
  for (const edit of edits) {
    out += text.slice(cursor, edit.at) + edit.text
    cursor = edit.at
  }
  return out + text.slice(cursor)
}

/**
 * The view of `source`.
 *
 * `activeLine` is the line being typed, when there is one. A buffer is rarely
 * valid code at the moment a completion is asked for (`order.` ends in a
 * dot), and code that does not parse cannot be rewritten. The line being
 * typed is then set aside: the rest of the buffer is rewritten as if that
 * line were blank, and the line itself is left exactly as typed. That keeps
 * what matters for a completion, the types of the names declared above it.
 */
export function typeView(source: string, activeLine?: number): TypeView {
  let { edits } = settleTopLevel(source, { wrap: SETTLE_TYPE_WRAP })
  const sourceStarts = lineStarts(source)
  if (!edits.length && activeLine !== undefined && activeLine >= 0 && activeLine < sourceStarts.length) {
    const from = sourceStarts[activeLine]!
    const to = activeLine + 1 < sourceStarts.length ? sourceStarts[activeLine + 1]! - 1 : source.length
    // Same length, so every offset outside the line means what it meant.
    const blanked = source.slice(0, from) + ' '.repeat(to - from) + source.slice(to)
    edits = settleTopLevel(blanked, { wrap: SETTLE_TYPE_WRAP }).edits
  }
  if (!edits.length) {
    const same = (position: TextPosition): TextPosition => position
    return { text: source, toView: same, toSource: same }
  }
  const code = apply(source, edits)
  const viewStarts = lineStarts(code)
  return {
    text: code,
    toView: position => positionAt(viewStarts, settledOffset(edits, offsetAt(sourceStarts, source.length, position))),
    toSource: position => positionAt(sourceStarts, originalOffset(edits, offsetAt(viewStarts, code.length, position))),
  }
}
