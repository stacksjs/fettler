/**
 * TinkerBelle beside Tinkerwell. Every statement about Tinkerwell was read from
 * its public site or docs on the date in `checked`, and each row links the
 * page it came from. If Tinkerwell changes, change the row and the date.
 *
 * `edge` says who the row favours, so the page can say where Tinkerwell is
 * ahead instead of leaving the reader to work it out.
 */

export const checked = '2026-11-11'
export const checkedLabel = 'November 11, 2026'

export type Edge = 'tinkerbelle' | 'tinkerwell' | 'even' | 'different'

export interface CompareRow {
  topic: string
  tinkerbelle: string
  tinkerwell: string
  edge: Edge
  source: string
}

export interface CompareGroup {
  title: string
  rows: CompareRow[]
}

const T = 'https://tinkerwell.app'

export const groups: CompareGroup[] = [
  {
    title: 'What it runs',
    rows: [
      {
        topic: 'Language',
        tinkerbelle: 'TypeScript, against a booted Stacks app.',
        tinkerwell: 'PHP only, with drivers for Laravel, Symfony, WordPress, Statamic and Magento.',
        edge: 'different',
        source: `${T}/`,
      },
      {
        topic: 'Availability',
        tinkerbelle: 'Early beta for macOS. Windows and Linux are not built yet.',
        tinkerwell: 'Shipping today, at version 5.',
        edge: 'tinkerwell',
        source: `${T}/whats-new-in-tinkerwell-5`,
      },
      {
        topic: 'Platforms',
        tinkerbelle: 'macOS, Windows and Linux, all three planned for the first public beta.',
        tinkerwell: 'macOS, Windows and Linux.',
        edge: 'tinkerwell',
        source: `${T}/`,
      },
      {
        topic: 'Remote targets',
        tinkerbelle: 'SSH, servers deployed with buddy deploy, Docker and Kubernetes. Coming with Pro.',
        tinkerwell: 'Documents SSH, Docker, Kubernetes, Laravel Vapor, Laravel Cloud and Laravel Forge.',
        edge: 'tinkerwell',
        source: `${T}/docs/5/setup-guides/ssh`,
      },
    ],
  },
  {
    title: 'Price and license',
    rows: [
      {
        topic: 'Standard license',
        tinkerbelle: '$39. One year of updates, a perpetual fallback license, 2 devices.',
        tinkerwell: '$49. One year of updates, a perpetual fallback license, 2 devices. Sold through Paddle.',
        edge: 'tinkerbelle',
        source: `${T}/checkout`,
      },
      {
        topic: 'Lifetime license',
        tinkerbelle: '$149.',
        tinkerwell: '$199.',
        edge: 'tinkerbelle',
        source: `${T}/checkout?lifetime=1`,
      },
    ],
  },
  {
    title: 'Tools around the editor',
    rows: [
      {
        topic: 'AI',
        tinkerbelle: 'Bring your own API key. Coming with Pro.',
        tinkerwell: 'Bring your own API key.',
        edge: 'even',
        source: `${T}/docs/5/advanced-usage/ai-assistant`,
      },
      {
        topic: 'Logs',
        tinkerbelle: 'Tails the log as lines are written. Coming.',
        tinkerwell: 'A log viewer that refreshes by polling at an interval you choose.',
        edge: 'different',
        source: `${T}/docs/5/advanced-usage/log-viewer`,
      },
      {
        topic: 'SQL view',
        tinkerbelle: 'A SQL panel for the queries a snippet ran, in any Stacks app. Coming.',
        tinkerwell: 'A SQL view for Laravel and WordPress projects only.',
        edge: 'different',
        source: `${T}/docs/5/basic-usage/detail-dive`,
      },
      {
        topic: 'MCP server',
        tinkerbelle: 'None.',
        tinkerwell: 'Yes. Its local tool does not use a project\'s Docker settings.',
        edge: 'tinkerwell',
        source: `${T}/docs/5/advanced-usage/mcp-server`,
      },
      {
        topic: 'Editor plugin',
        tinkerbelle: 'None.',
        tinkerwell: 'A PhpStorm plugin.',
        edge: 'tinkerwell',
        source: `${T}/docs/5/getting-started/phpstorm-plugin`,
      },
      {
        topic: 'Step debugging',
        tinkerbelle: 'None.',
        tinkerwell: 'Debugging with Xdebug.',
        edge: 'tinkerwell',
        source: `${T}/docs/5/advanced-usage/debugging-with-xdebug`,
      },
    ],
  },
]

/** Where Tinkerwell is the better choice, said plainly. */
export const tinkerwellAhead = [
  {
    title: 'It exists today',
    body: 'Tinkerwell is at version 5 and you can buy and run it now. TinkerBelle is in development and has no download.',
  },
  {
    title: 'The PHP ecosystem',
    body: 'If your app is Laravel, Symfony, WordPress, Statamic or Magento, Tinkerwell is built for it. TinkerBelle does not run PHP.',
  },
  {
    title: 'A PhpStorm plugin',
    body: 'Tinkerwell runs code from inside PhpStorm. TinkerBelle has no editor plugin.',
  },
  {
    title: 'Xdebug',
    body: 'Tinkerwell can step through code with Xdebug. TinkerBelle has no step debugger.',
  },
]

const edgeLabels: Record<Edge, string> = {
  tinkerbelle: 'TinkerBelle costs less',
  tinkerwell: 'Tinkerwell is ahead',
  even: 'The same',
  different: 'Different approach',
}

/** Rows with the label resolved, because a template cannot index by a member. */
export const compareGroups = groups.map(group => ({
  ...group,
  rows: group.rows.map(row => ({
    ...row,
    edgeLabel: edgeLabels[row.edge],
    ahead: row.edge === 'tinkerwell',
  })),
}))
