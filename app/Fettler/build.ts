/**
 * What this build is. The release command rewrites the version and the date;
 * everything else is decided here by hand.
 */

/** Stays on 0.x until the owner approves a 1.0. */
export const VERSION = '0.0.0'

/**
 * When this build was released, baked in at release time. A standard license
 * unlocks every build released on or before its `updatesUntil`, so this must
 * never be read from the clock: that would make an old build look new.
 */
export const BUILD_DATE = '2026-11-12'

/** The license routes of the hosted site. */
export const LICENSE_ENDPOINT = 'https://fettler.org/licenses'

/**
 * Key id to public key: the trust root for license tokens. Empty until the
 * signing key exists (`buddy license:keygen`); with no key no token can be
 * trusted and nothing is treated as licensed.
 */
export const LICENSE_PUBLIC_KEYS: Record<string, string> = {}

/**
 * While licenses are not on sale, Pro features are open to everyone on a beta
 * build and the app says so. Set to false in the change that opens checkout.
 */
export const PRO_OPEN_BETA = true

/** What a Pro license unlocks, by the name the agent refuses with. */
export const PRO_FEATURES = {
  remote: 'Remote targets (SSH, Docker, Kubernetes and deployed servers)',
  ai: 'AI suggestions and the assistant',
  mcp: 'MCP access for AI tools',
} as const

export type ProFeature = keyof typeof PRO_FEATURES
