import { Action } from '@stacksjs/actions/runtime'
import { Storage } from '@stacksjs/storage'

/** What `buddy release:desktop` writes beside the manifests: every build of the newest release. */
interface ReleaseRecord {
  version: string
  targets: { target: string, downloads: { name: string, url: string }[] }[]
}

const PLATFORMS: Record<string, string> = { macos: 'darwin-', windows: 'win32-', linux: 'linux-' }

/** The newest build a person downloads for a platform (the DMG, the MSI, the AppImage), or null when there is none. */
export function latestDownload(record: ReleaseRecord, platform: string, architecture?: string): string | null {
  const prefix = PLATFORMS[platform]
  if (!prefix)
    return null
  const builds = record.targets.filter(target => target.target.startsWith(prefix) && target.downloads.length > 0)
  const build = builds.find(target => target.target === `${prefix}${architecture}`) ?? builds[0]
  return build?.downloads[0]?.url ?? null
}

/**
 * `GET /api/download/{platform}`: the newest released build for macOS, Windows
 * or Linux, as a redirect to the file. The site links here, so a release
 * changes what is downloaded without the site being deployed again.
 */
export default new Action({
  name: 'LatestDownloadAction',
  description: 'Redirects to the newest desktop build for a platform.',
  method: 'GET',

  async handle(request: RequestInstance) {
    const disk = Storage.disk()
    const key = 'desktop-updates/stable/release.json'
    const stored = await disk.fileExists(key) ? await disk.readToString(key) : null
    let url: string | null = null
    try {
      const arch = request.get('arch')
      if (stored)
        url = latestDownload(JSON.parse(stored) as ReleaseRecord, String(request.getParam('platform') ?? ''), typeof arch === 'string' ? arch : undefined)
    }
    catch {
      url = null
    }
    if (!url)
      return new Response(JSON.stringify({ error: 'There is no build for this platform yet.' }), { status: 404, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })
    return new Response(null, { status: 302, headers: { 'location': url, 'cache-control': 'no-store' } })
  },
})
