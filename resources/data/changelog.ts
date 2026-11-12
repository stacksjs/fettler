import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

/**
 * The changelog, read from `content/changelog/*.md`: one file per release.
 * Each file opens with a small front matter block and the rest is Markdown.
 *
 *   ---
 *   title: The first beta
 *   date: 2026-11-11
 *   version: 0.3.2        (omit until a build with that version exists)
 *   status: In development
 *   ---
 *
 * Entries sort newest first by `date`. A file without a title or a date is a
 * mistake in the file, so it throws here and the page fails loudly instead of
 * printing a blank entry.
 */

export interface ChangelogEntry {
  slug: string
  title: string
  /** ISO date, as written in the file. */
  date: string
  /** "November 11, 2026". */
  dateLabel: string
  /** A 0.x version once the entry describes a build; empty before that. */
  version: string
  /** A short state for an entry that is not a build, such as "In development". */
  status: string
  html: string
}

const directory = join(process.cwd(), 'content', 'changelog')

function parse(slug: string, source: string): ChangelogEntry {
  const match = source.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!match)
    throw new Error(`content/changelog/${slug}.md has no front matter block`)

  const meta: Record<string, string> = {}
  for (const row of match[1]!.split('\n')) {
    const colon = row.indexOf(':')
    if (colon === -1)
      continue
    meta[row.slice(0, colon).trim()] = row.slice(colon + 1).trim().replace(/^['"]|['"]$/g, '')
  }

  if (!meta.title || !meta.date)
    throw new Error(`content/changelog/${slug}.md needs a title and a date`)

  const day = new Date(`${meta.date}T00:00:00Z`)
  if (Number.isNaN(day.getTime()))
    throw new Error(`content/changelog/${slug}.md has an unreadable date: ${meta.date}`)

  return {
    slug,
    title: meta.title,
    date: meta.date,
    dateLabel: new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' }).format(day),
    version: meta.version ?? '',
    status: meta.status ?? '',
    html: Bun.markdown.html(match[2]!),
  }
}

export function changelogEntries(): ChangelogEntry[] {
  return readdirSync(directory)
    .filter(file => file.endsWith('.md'))
    .map(file => parse(file.slice(0, -3), readFileSync(join(directory, file), 'utf8')))
    .sort((a, b) => b.date.localeCompare(a.date))
}
