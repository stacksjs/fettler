/**
 * What the site says about itself in more than one place: the nav, the footer,
 * the head tags and the download state. One list, so a page cannot disagree
 * with the chrome around it.
 */

import { productionOrigin } from '../../config/address'

export const site = {
  name: 'TinkerBelle',
  // From APP_URL, like every other address the app names (config/address.ts).
  url: productionOrigin(),
  title: 'TinkerBelle: run TypeScript against your real Stacks app',
  description: 'TinkerBelle is a desktop app for macOS, Windows and Linux that runs TypeScript against a booted Stacks app, locally or on a remote target. In early beta.',
}

export interface NavLink {
  label: string
  href: string
}

export const navLinks: NavLink[] = [
  { label: 'Features', href: '/features' },
  { label: 'Pricing', href: '/pricing' },
  { label: 'Compare', href: '/compare' },
  { label: 'Changelog', href: '/changelog' },
]

export const footerLinks: NavLink[] = [
  ...navLinks,
  { label: 'Download', href: '/download' },
  { label: 'Privacy', href: '/privacy' },
  { label: 'Terms', href: '/terms' },
]

export type PlatformId = 'macos' | 'windows' | 'linux'

export interface Platform {
  id: PlatformId
  name: string
  icon: string
  /** The build's address once there is one. Empty means not released. */
  url: string
}

/**
 * The release record. A platform with an empty `url` has no build yet and the
 * site says so. `buddy release:desktop` prints the address of each new build.
 */
export const release = {
  /** A 0.x version string once a build exists. */
  version: '0.1.1',
  platforms: [
    { id: 'macos', name: 'macOS', icon: 'i-hugeicons-apple', url: '/api/download/macos' },
    { id: 'windows', name: 'Windows', icon: 'i-hugeicons-windows-new', url: '' },
    { id: 'linux', name: 'Linux', icon: 'i-hugeicons-computer-terminal-02', url: '' },
  ] as Platform[],
}

export const released = release.platforms.some(platform => platform.url !== '')
