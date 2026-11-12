import { describe, expect, test } from 'bun:test'
import { saleOf, siteOrigin, startCheckout, thanksFor } from '../../app/Billing/checkout'
import { planById } from '../../app/Billing/plans'

function deps(overrides: Record<string, unknown> = {}) {
  const calls: any[] = []
  return {
    calls,
    value: {
      open: true,
      origin: 'https://fettler.org',
      reference: (tier: string) => `license:${tier}:abc`,
      checkout: async (request: any) => {
        calls.push(request)
        return { url: 'https://pay.example/session' }
      },
      ...overrides,
    } as any,
  }
}

describe('checkout', () => {
  test('only the two paid plans are for sale, at the price the plans list', () => {
    expect(saleOf(planById('standard'))).toEqual({ tier: 'standard', name: 'Fettler Pro Standard', unitAmount: 3900 })
    expect(saleOf(planById('lifetime'))).toMatchObject({ tier: 'lifetime', unitAmount: 14900 })
    expect(saleOf(planById('free'))).toBeUndefined()
    expect(saleOf(planById('nope'))).toBeUndefined()
  })

  test('a paid plan starts a hosted checkout that carries the license reference both ways', async () => {
    const { calls, value } = deps()
    expect(await startCheckout('standard', value)).toEqual({ kind: 'redirect', url: 'https://pay.example/session' })
    expect(calls[0]).toEqual({
      lines: [{ name: 'Fettler Pro Standard', unitAmount: 3900, quantity: 1 }],
      successUrl: 'https://fettler.org/thanks?purchase=license%3Astandard%3Aabc',
      cancelUrl: 'https://fettler.org/pricing',
      reference: 'license:standard:abc',
      metadata: { product: 'fettler', tier: 'standard' },
    })
  })

  test('while checkout is closed nothing is started', async () => {
    const { calls, value } = deps({ open: false })
    expect(await startCheckout('lifetime', value)).toEqual({ kind: 'closed' })
    expect(calls).toEqual([])
  })

  test('an unknown or free plan is not found, and a provider failure charges nothing and says so', async () => {
    expect(await startCheckout('free', deps().value)).toEqual({ kind: 'unknown-plan' })
    expect(await startCheckout(undefined, deps().value)).toEqual({ kind: 'unknown-plan' })
    const failing = deps({ checkout: async () => { throw new Error('provider down') } })
    expect(await startCheckout('standard', failing.value)).toEqual({ kind: 'unavailable', reason: 'provider down' })
    expect(await startCheckout('standard', deps({ origin: '' }).value)).toMatchObject({ kind: 'unavailable' })
  })

  test('the site origin is read with or without a scheme', () => {
    expect(siteOrigin('fettler.org/')).toBe('https://fettler.org')
    expect(siteOrigin('http://fettler.localhost')).toBe('http://fettler.localhost')
    expect(siteOrigin('')).toBe('')
  })
})

describe('the thank-you page', () => {
  test('shows the key only for a license that exists and is in good standing', async () => {
    const find = async (reference: string) => reference === 'paid' ? { key: 'AAAA-BBBB', tier: 'lifetime', email: 'a@b.test', status: 'active' } : reference === 'refunded' ? { key: 'CCCC', tier: 'standard', status: 'refunded' } : null
    expect(await thanksFor('paid', { find })).toEqual({ licenseKey: 'AAAA-BBBB', tier: 'lifetime', email: 'a@b.test', activateUrl: 'fettler://activate?key=AAAA-BBBB' })
    expect(await thanksFor('refunded', { find })).toBeNull()
    expect(await thanksFor('pending', { find })).toBeNull()
    expect(await thanksFor(undefined, { find })).toBeNull()
    expect(await thanksFor('x'.repeat(300), { find })).toBeNull()
  })

  test('a lookup that fails claims nothing', async () => {
    expect(await thanksFor('any', { find: async () => { throw new Error('db down') } })).toBeNull()
  })
})
