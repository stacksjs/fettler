import { describe, expect, test } from 'bun:test'
import { typeView } from '../../app/TinkerBelle/type-view'

describe('the buffer as the type checker reads it', () => {
  test('wraps what a session waits for and maps positions both ways', () => {
    const source = 'const order = Order.create({ total: 1 })\norder.total'
    const view = typeView(source)
    expect(view.text).toBe('const order = __tinkerSettled(Order.create({ total: 1 }))\n;__tinkerSettled(order.total)')
    // `total` on line 1 is at column 6 in what the user typed.
    const at = view.toView({ line: 1, column: 6 })
    expect(view.text.split('\n')[1]!.slice(at.column, at.column + 5)).toBe('total')
    expect(view.toSource(at)).toEqual({ line: 1, column: 6 })
    // A position inside inserted text maps to where it was inserted.
    expect(view.toSource({ line: 0, column: 16 })).toEqual({ line: 0, column: 14 })
    // A column past the end of a line stays on that line.
    expect(view.toView({ line: 0, column: 999 }).line).toBe(0)
  })

  test('a half-typed line is set aside so the names above it keep their types', () => {
    const source = 'const order = Order.create({ total: 1 })\norder.'
    // As it stands the buffer does not parse, so nothing can be rewritten.
    expect(typeView(source).text).toBe(source)
    const view = typeView(source, 1)
    expect(view.text).toBe('const order = __tinkerSettled(Order.create({ total: 1 }))\norder.')
    expect(view.toView({ line: 1, column: 6 })).toEqual({ line: 1, column: 6 })
  })

  test('nothing to wait for leaves the buffer as it is', () => {
    const view = typeView('const total = 1 + 1')
    expect(view.text).toBe('const total = 1 + 1')
    expect(view.toView({ line: 0, column: 3 })).toEqual({ line: 0, column: 3 })
  })
})
