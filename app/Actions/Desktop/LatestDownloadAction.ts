import { Action } from '@stacksjs/actions/runtime'
import { Storage } from '@stacksjs/storage'

/** What `buddy release:desktop` writes beside the manifests: every build of the newest release. */
interface ReleaseFile { name?: string, url: string }

interface ReleaseRecord {
  version: string
  targets: { target: string, update?: ReleaseFile, downloads: ReleaseFile[] }[]
}

const PLATFORMS: Record<string, string> = { macos: 'darwin-', windows: 'win32-', linux: 'linux-' }

/**
 * The newest build a person downloads for a platform, or null when there is none.
 *
 * What an installed app updates from and what a person installs are the same
 * file on Windows (the MSI) and on Linux by default (the AppImage, which runs
 * anywhere); on macOS a person takes the disk image and the app updates from a
 * zip. `format` asks for another package the release has: `deb` or `rpm`.
 */
export function latestDownload(record: ReleaseRecord, platform: string, architecture?: string, format?: string): string | null {
  const prefix = PLATFORMS[platform]
  if (!prefix)
    return null
  const builds = record.targets.filter(target => target.target.startsWith(prefix))
  const build = builds.find(target => target.target === `${prefix}${architecture}`) ?? builds[0]
  if (!build)
    return null
  const files = [...build.downloads, ...(build.update ? [build.update] : [])]
  const ending = (file: ReleaseFile): string => file.url.split('?')[0]!.toLowerCase()
  if (format)
    return /^[a-z0-9]+$/i.test(format) ? files.find(file => ending(file).endsWith(`.${format.toLowerCase()}`))?.url ?? null : null
  const preferred = platform === 'macos' ? ['.dmg'] : platform === 'windows' ? ['.msi', '.exe'] : ['.appimage', '.deb', '.rpm']
  for (const suffix of preferred) {
    const match = files.find(file => ending(file).endsWith(suffix))
    if (match)
      return match.url
  }
  return null
}

/**
 * `GET /api/download/{platform}`: the newest released build for macOS, Windows
 * or Linux, as a redirect to the file. `?format=deb` or `?format=rpm` asks for
 * that Linux package. The site links here, so a release
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
      const format = request.get('format')
      if (stored)
        url = latestDownload(JSON.parse(stored) as ReleaseRecord, String(request.getParam('platform') ?? ''), typeof arch === 'string' ? arch : undefined, typeof format === 'string' ? format : undefined)
    }
    catch {
      url = null
    }
    if (!url)
      return new Response(JSON.stringify({ error: 'There is no build for this platform yet.' }), { status: 404, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })
    return new Response(null, { status: 302, headers: { 'location': url, 'cache-control': 'no-store' } })
  },
})
