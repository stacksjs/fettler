import { describe, expect, test } from 'bun:test'
import { latestDownload } from '../../app/Actions/Desktop/LatestDownloadAction'

const record = {
  version: '0.1.1',
  targets: [
    { target: 'darwin-x64', downloads: [{ name: 'Fettler-0.1.1-x64.dmg', url: 'https://fettler.org/x64.dmg' }] },
    { target: 'darwin-arm64', downloads: [{ name: 'Fettler-0.1.1-arm64.dmg', url: 'https://fettler.org/arm64.dmg' }] },
    { target: 'linux-x64', downloads: [] },
  ],
}

describe('the newest build for a platform', () => {
  test('is the one for the architecture asked for, else the first', () => {
    expect(latestDownload(record, 'macos', 'arm64')).toBe('https://fettler.org/arm64.dmg')
    expect(latestDownload(record, 'macos')).toBe('https://fettler.org/x64.dmg')
  })

  test('is nothing for a platform with no build, or one that does not exist', () => {
    expect(latestDownload(record, 'linux')).toBeNull()
    expect(latestDownload(record, 'windows')).toBeNull()
    expect(latestDownload(record, '../etc')).toBeNull()
  })
})
