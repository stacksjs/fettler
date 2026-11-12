import { describe, expect, test } from 'bun:test'
import { trimHover } from '../../resources/functions/hover-text'

describe('a hover cut to fit', () => {
  test('a short one is left alone', () => {
    expect(trimHover('```ts\nconst a: number\n```')).toBe('```ts\nconst a: number\n```')
  })

  test('a long code block keeps its first lines, closes its fence and says what was left out', () => {
    const long = ['```ts', ...Array.from({ length: 40 }, (_, index) => `  field${index}: string`), '```'].join('\n')
    const out = trimHover(long, 5).split('\n')
    expect(out.slice(0, 5)).toEqual(['```ts', '  field0: string', '  field1: string', '  field2: string', '  field3: string'])
    expect(out[5]).toBe('```')
    expect(out.at(-1)).toBe('37 more lines')
  })

  test('a cut after a closed block adds no fence', () => {
    const text = ['```ts', 'a', '```', ...Array.from({ length: 10 }, () => 'prose')].join('\n')
    expect(trimHover(text, 4).split('\n')).toEqual(['```ts', 'a', '```', 'prose', '', '9 more lines'])
  })
})
