/**
 * Questions and answers, grouped by the page that asks them. Each answer
 * states only what is decided; where something is not settled it says so.
 */

export interface FaqItem {
  q: string
  a: string
}

export const homeFaqs: FaqItem[] = [
  {
    q: 'Can I download Fettler today?',
    a: 'No. Fettler is in development and there is no build to download. The first public release will be a 0.x beta for macOS, Windows and Linux, and the changelog is where it will be announced.',
  },
  {
    q: 'What does it run my code against?',
    a: 'Your real Stacks app, booted: its models, actions, jobs, config and queries. A snippet sees what your app sees.',
  },
  {
    q: 'Does it change anything on my server?',
    a: 'Fettler writes nothing on a remote server to run a snippet. Your code can still change data, the same as it would anywhere else, so treat production with care.',
  },
  {
    q: 'Do I have to rerun everything each time?',
    a: 'No. State remains between runs, so a variable you set in one run is still there in the next.',
  },
  {
    q: 'Is it free?',
    a: 'Local projects and the sandbox are free. Pro adds remote targets, AI and team sharing, for $39 with a year of updates or $149 for a lifetime license.',
  },
]

export const pricingFaqs: FaqItem[] = [
  {
    q: 'Can I buy Pro now?',
    a: 'Not yet. Checkout opens when there is a beta build to run. The prices on this page are the prices it will open with.',
  },
  {
    q: 'What happens when my year of updates ends?',
    a: 'You keep the last version you received and its Pro features, for good. That is the perpetual fallback license. Buying again gets you another year of updates.',
  },
  {
    q: 'How many devices can I use?',
    a: 'A Pro Standard license activates on 2 devices.',
  },
  {
    q: 'What does the AI cost?',
    a: 'Nothing from us. You bring an API key from your own provider and pay them for what you use.',
  },
  {
    q: 'Is there a team plan?',
    a: 'Team seats are planned. They do not have a price yet, so none is printed here.',
  },
  {
    q: 'Do I need Pro for my own machine?',
    a: 'No. Local projects and the sandbox are free, with no license key and no time limit.',
  },
]

export const downloadFaqs: FaqItem[] = [
  {
    q: 'When is the beta?',
    a: 'There is no date. This page and the changelog will change the day a build exists.',
  },
  {
    q: 'Which platforms will the first beta support?',
    a: 'macOS, Windows and Linux, together.',
  },
  {
    q: 'What will I need?',
    a: 'A Stacks app to point it at, or the built-in sandbox if you just want to try it.',
  },
]
