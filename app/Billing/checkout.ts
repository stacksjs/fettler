import type { Plan } from './plans'
import process from 'node:process'
import { CHECKOUT_OPEN, planById, PRODUCT_NAME } from './plans'

/**
 * Buying a TinkerBelle Pro license.
 *
 * The payment provider hosts the payment page; this site never sees a card.
 * A checkout carries a license purchase reference, the provider echoes it in
 * its webhook, and the framework's licensing issues the license once for that
 * reference and emails the key. The thank-you page reads the key by the same
 * reference. Nothing here is specific to one provider: it goes through the
 * configured payment driver.
 */

export type CheckoutOutcome =
  | { kind: 'redirect', url: string }
  | { kind: 'unknown-plan' }
  /** Checkout is not open: there is no build to sell yet. */
  | { kind: 'closed' }
  | { kind: 'unavailable', reason: string }

export interface CheckoutDeps {
  open: boolean
  origin: string
  /** A new license purchase reference for a tier. */
  reference: (tier: 'standard' | 'lifetime') => string
  /** Start a hosted checkout and answer where to send the buyer. */
  checkout: (request: { lines: Array<{ name: string, unitAmount: number, quantity: number }>, successUrl: string, cancelUrl: string, reference: string, metadata: Record<string, string> }) => Promise<{ url: string }>
}

/** The public origin, from APP_URL, which may be written with or without a scheme. */
export function siteOrigin(appUrl = process.env.APP_URL ?? ''): string {
  const host = appUrl.trim().replace(/\/+$/, '')
  if (!host)
    return ''
  return /^https?:\/\//.test(host) ? host : `https://${host}`
}

async function liveDeps(): Promise<CheckoutDeps> {
  const { licensing } = await import('@stacksjs/commerce')
  const { paymentDriver } = await import('@stacksjs/payments')
  return {
    open: CHECKOUT_OPEN,
    origin: siteOrigin(),
    reference: tier => licensing.licensePurchaseReference({ tier }),
    // A buyer has no account here. The provider collects the address, and the
    // license is issued to it.
    checkout: request => paymentDriver().checkout({ id: `guest:${crypto.randomUUID()}` }, { mode: 'payment', currency: 'usd', automaticTax: true, allowPromotionCodes: true, ...request }),
  }
}

/** What a plan is sold as. Only the two paid plans are for sale. */
export function saleOf(plan: Plan | undefined): { tier: 'standard' | 'lifetime', name: string, unitAmount: number } | undefined {
  if (!plan || !plan.pro || plan.priceCents <= 0)
    return undefined
  if (plan.id !== 'standard' && plan.id !== 'lifetime')
    return undefined
  return { tier: plan.id, name: `${PRODUCT_NAME} ${plan.name}`, unitAmount: plan.priceCents }
}

export async function startCheckout(planId: unknown, deps?: CheckoutDeps): Promise<CheckoutOutcome> {
  const sale = saleOf(planById(planId))
  if (!sale)
    return { kind: 'unknown-plan' }

  let resolved: CheckoutDeps
  try {
    resolved = deps ?? await liveDeps()
  }
  catch (error) {
    return { kind: 'unavailable', reason: error instanceof Error ? error.message : String(error) }
  }
  if (!resolved.open)
    return { kind: 'closed' }
  if (!resolved.origin)
    return { kind: 'unavailable', reason: 'APP_URL is not set, so there is nowhere to return the buyer to.' }

  try {
    const reference = resolved.reference(sale.tier)
    const session = await resolved.checkout({
      lines: [{ name: sale.name, unitAmount: sale.unitAmount, quantity: 1 }],
      successUrl: `${resolved.origin}/thanks?purchase=${encodeURIComponent(reference)}`,
      cancelUrl: `${resolved.origin}/pricing`,
      reference,
      metadata: { product: 'tinkerbelle', tier: sale.tier },
    })
    return session.url ? { kind: 'redirect', url: session.url } : { kind: 'unavailable', reason: 'The payment provider returned no page to send the buyer to.' }
  }
  catch (error) {
    return { kind: 'unavailable', reason: error instanceof Error ? error.message : String(error) }
  }
}

export interface Thanks {
  /** The key, once the payment has been confirmed and the license issued. */
  licenseKey: string
  tier: string
  email: string
  /** Opens TinkerBelle on its license dialog with the key filled in. */
  activateUrl: string
}

export interface ThanksDeps {
  find: (reference: string) => Promise<{ key: string, tier: string, email?: string | null, status?: string } | null | undefined>
}

/**
 * What the thank-you page may say for a purchase reference. Null until the
 * provider has confirmed the payment: the page then says the key is on its
 * way by email instead of claiming a license that does not exist yet.
 */
export async function thanksFor(reference: unknown, deps?: ThanksDeps): Promise<Thanks | null> {
  if (typeof reference !== 'string' || !reference || reference.length > 200)
    return null
  try {
    const find = deps?.find ?? (async (ref: string) => (await import('@stacksjs/commerce')).licensing.findLicenseByPurchase(ref) as never)
    const license = await find(reference)
    if (!license?.key || (license.status && license.status !== 'active' && license.status !== 'unassigned'))
      return null
    return {
      licenseKey: license.key,
      tier: license.tier,
      email: license.email ?? '',
      activateUrl: `tinkerbelle://activate?key=${encodeURIComponent(license.key)}`,
    }
  }
  catch {
    return null
  }
}
