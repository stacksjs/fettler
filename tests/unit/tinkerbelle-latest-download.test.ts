import { describe, expect, test } from 'bun:test'
import { latestDownload } from '../../app/Actions/Desktop/LatestDownloadAction'

const at = (file: string) => `https://tinkerbelle.app/files/${file}`
// The shape `buddy release:desktop` writes: what an app updates from, and what else a person can take.
const record = {
  version: '0.2.2',
  targets: [
    { target: 'darwin-x64', update: { url: at('x64.zip') }, downloads: [{ name: 'x64.dmg', url: at('x64.dmg') }] },
    { target: 'darwin-arm64', update: { url: at('arm64.zip') }, downloads: [{ name: 'arm64.dmg', url: at('arm64.dmg') }] },
    { target: 'linux-x64', update: { url: at('x64.AppImage') }, downloads: [{ name: 'x64.deb', url: at('x64.deb') }, { name: 'x64.rpm', url: at('x64.rpm') }] },
    { target: 'win32-x64', update: { url: at('x64.msi') }, downloads: [] },
  ],
}

describe('the newest build for a platform', () => {
  test('macOS is the disk image, for the architecture asked for or else the first', () => {
    expect(latestDownload(record, 'macos', 'arm64')).toBe(at('arm64.dmg'))
    expect(latestDownload(record, 'macos')).toBe(at('x64.dmg'))
  })

  test('Windows is the installer the app also updates from', () => {
    expect(latestDownload(record, 'windows')).toBe(at('x64.msi'))
  })

  test('Linux is the AppImage unless a package is asked for', () => {
    expect(latestDownload(record, 'linux')).toBe(at('x64.AppImage'))
    expect(latestDownload(record, 'linux', undefined, 'deb')).toBe(at('x64.deb'))
    expect(latestDownload(record, 'linux', undefined, 'rpm')).toBe(at('x64.rpm'))
  })

  test('is nothing for a format the release has not got, or a platform that does not exist', () => {
    expect(latestDownload(record, 'linux', undefined, 'snap')).toBeNull()
    expect(latestDownload(record, 'linux', undefined, '../x')).toBeNull()
    expect(latestDownload({ version: '1', targets: [] }, 'windows')).toBeNull()
    expect(latestDownload(record, '../etc')).toBeNull()
  })
})
