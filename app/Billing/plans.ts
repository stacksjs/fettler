/**
 * Fettler's plans: the one list the pricing page reads, and the one checkout
 * and the desktop app will read when they exist. Prices are integer cents.
 *
 * Free covers local projects and the sandbox. Pro is one product sold two
 * ways: Standard (a year of updates, then a perpetual fallback license) and
 * Lifetime. Team seats are planned and have no price yet, so there is no team
 * plan here to print.
 */

export type PlanId = 'free' | 'standard' | 'lifetime'

export interface Plan {
  id: PlanId
  name: string
  /** Minor units: 3900 is $39. */
  priceCents: number
  /** Beside the price: what the number buys. */
  cadence: string
  blurb: string
  /** What the plan includes, in the order the card lists it. */
  includes: string[]
  /** Under the button: how the license behaves over time. */
  terms: string
  /** Pro plans unlock remote targets, AI and team sharing. */
  pro: boolean
  /** Devices one license activates on, where that is settled. */
  maxDevices?: number
  /** Years of updates a purchase carries; none means every update. */
  updateYears?: number
}

export const PRODUCT_NAME = 'Fettler'

/**
 * False until there is a build to sell. While it is false the pricing page
 * prints prices and says checkout is not open, and no button leads to
 * `/checkout/<plan>`. Flip it in the change that adds the checkout route.
 */
export const CHECKOUT_OPEN = false

/** What a Pro license adds to the free app. */
export const PRO_UNLOCKS = [
  'Remote targets: SSH, servers deployed with buddy deploy, Docker and Kubernetes',
  'AI with your own API key',
  'Team sharing',
]

export const PLANS: Plan[] = [
  {
    id: 'free',
    name: 'Free',
    priceCents: 0,
    cadence: 'for local work',
    blurb: 'The whole app against projects on your own machine.',
    includes: [
      'Local projects',
      'The sandbox',
      'Typed result cards, table mode and the SQL panel',
      'Snippets, history and themes',
    ],
    terms: 'No license key and no time limit.',
    pro: false,
  },
  {
    id: 'standard',
    name: 'Pro Standard',
    priceCents: 3900,
    cadence: 'once',
    blurb: 'Pro, with a year of updates.',
    includes: [
      'Everything in Free',
      ...PRO_UNLOCKS,
      'One year of updates',
      'Activates on 2 devices',
    ],
    terms: 'After the year you keep the last version you received, for good.',
    pro: true,
    maxDevices: 2,
    updateYears: 1,
  },
  {
    id: 'lifetime',
    name: 'Pro Lifetime',
    priceCents: 14900,
    cadence: 'once',
    blurb: 'Pro, with every update.',
    includes: [
      'Everything in Free',
      ...PRO_UNLOCKS,
      'Every future update',
    ],
    terms: 'One payment. It never renews.',
    pro: true,
  },
]

export function planById(id: unknown): Plan | undefined {
  return PLANS.find(plan => plan.id === id)
}

/** "$39" or "$1.99". Cents in, a display string out, at the last moment. */
export function formatCents(cents: number, currency = 'usd'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100)
}
