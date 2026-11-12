/**
 * What TinkerBelle does, as one list read by the home page and the features page.
 * Everything here is being built for the 0.x beta and none of it can be
 * downloaded yet; the pages say so once, at the top, instead of on every row.
 * `pro` marks what a Pro license unlocks.
 */

export interface Feature {
  title: string
  body: string
  icon: string
  pro?: boolean
}

/** What a booted app gives a snippet to work with. */
export const reach = ['models', 'actions', 'jobs', 'config', 'queries']

/** The result views, in the order the bento lays them out. */
export const results = {
  cards: {
    title: 'Typed result cards',
    body: 'A model, a collection or an error comes back as a card with its fields and their types, not a string.',
    icon: 'i-hugeicons-dashboard-square-01',
  },
  table: {
    title: 'Table mode',
    body: 'Read a list of rows as a table.',
    icon: 'i-hugeicons-table-01',
  },
  sql: {
    title: 'SQL panel',
    body: 'Every query a snippet ran, with its bindings, row count and time.',
    icon: 'i-hugeicons-database-01',
  },
  graph: {
    title: 'Relation graphs',
    body: 'See how a model connects to the ones around it.',
    icon: 'i-hugeicons-chart-relationship',
  },
  preview: {
    title: 'HTML preview',
    body: 'Render an stx view or a mail and look at it, without sending anything.',
    icon: 'i-hugeicons-browser',
  },
}

export interface Target {
  name: string
  detail: string
  icon: string
  pro: boolean
}

export const targets: Target[] = [
  { name: 'Local project', detail: 'Any Stacks app on this machine.', icon: 'i-hugeicons-laptop', pro: false },
  { name: 'Sandbox', detail: 'A scratch app for trying an idea.', icon: 'i-hugeicons-test-tube-01', pro: false },
  { name: 'SSH', detail: 'A server you can already reach.', icon: 'i-hugeicons-computer-terminal-01', pro: true },
  { name: 'buddy deploy', detail: 'Servers you deployed with buddy deploy.', icon: 'i-hugeicons-server-stack-01', pro: true },
  { name: 'Docker', detail: 'A running container.', icon: 'i-hugeicons-container', pro: true },
  { name: 'Kubernetes', detail: 'A pod in your cluster.', icon: 'i-hugeicons-ship-wheel', pro: true },
]

/** The two things worth a row each on the features page. */
export const editor = {
  completion: {
    title: 'Completion from the TypeScript language server',
    body: 'The editor asks the same language server your IDE uses, so a model\'s columns and a config key complete as you type.',
    icon: 'i-hugeicons-source-code',
  },
  magic: {
    title: 'Magic comments',
    body: 'Mark a line with a comment and its value appears beside it on the next run. No console.log, nothing to clean up after.',
    icon: 'i-hugeicons-comment-01',
  },
}

/** The rest, each a line. */
export const more: Feature[] = [
  { title: 'AI, with your own key', body: 'Bring an API key from your own provider.', icon: 'i-hugeicons-ai-brain-01', pro: true },
  { title: 'Log tailing', body: 'Watch the app\'s log while a snippet runs.', icon: 'i-hugeicons-left-to-right-list-bullet' },
  { title: 'Snippets', body: 'Keep the code you run every week.', icon: 'i-hugeicons-bookmark-01' },
  { title: 'History', body: 'Every run, ready to open again.', icon: 'i-hugeicons-clock-01' },
  { title: 'Themes', body: 'Change how the editor looks.', icon: 'i-hugeicons-paint-board' },
  { title: 'Drivers', body: 'Tell TinkerBelle how to boot a project.', icon: 'i-hugeicons-plug-01' },
  { title: 'Team sharing', body: 'Share your work with the people you work with.', icon: 'i-hugeicons-user-group', pro: true },
]
