/**
 * A hover, cut to what fits beside a word.
 *
 * The language server answers a model method with the whole model spelled out:
 * hundreds of lines for `User.first`. The first lines say what the thing is,
 * so those are kept and the rest is counted, with every code fence left closed.
 */
export function trimHover(text: string, maxLines = 14): string {
  const lines = text.split('\n')
  if (lines.length <= maxLines)
    return text
  const kept = lines.slice(0, maxLines)
  const hidden = lines.length - maxLines
  // An odd number of fences in what is kept means the cut landed inside a code block.
  const openFence = kept.filter(line => line.trimStart().startsWith('```')).length % 2 === 1
  return [...kept, ...(openFence ? ['```'] : []), '', `${hidden} more ${hidden === 1 ? 'line' : 'lines'}`].join('\n')
}
