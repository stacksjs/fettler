#!/usr/bin/env bun
/**
 * Fetches the Craft web view runtime for the platforms this machine cannot
 * supply itself: `bun bin/desktop-runtimes.ts`.
 *
 * A desktop build needs each target's own Craft binary. The Mac's comes from
 * the local Craft; Linux's and Windows' are the files Craft publishes with a
 * release, pinned here by version and checksum and unpacked where
 * config/desktop.ts looks for them.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

const CRAFT_VERSION = 'v0.0.499'
const RUNTIMES = [
  { target: 'linux-x64', asset: 'craft-linux-x64.zip', sha256: 'c1c665c510493be5fc8c45293d0bf81f79e18fd5848e4550193fec7f5ea3de84', expect: 'craft' },
  { target: 'win32-x64', asset: 'craft-windows-x64.zip', sha256: '64f8cc76005dafcc0c2b5183c06382518ba713acdb7e8130d0a18f0e899e07ba', expect: 'craft.exe' },
]

const root = join(import.meta.dir, '..')
const into = join(root, 'storage/framework/desktop/runtimes')

for (const runtime of RUNTIMES) {
  const directory = join(into, runtime.target)
  const stamp = join(directory, '.version')
  if (existsSync(join(directory, runtime.expect)) && existsSync(stamp) && readFileSync(stamp, 'utf8') === `${CRAFT_VERSION} ${runtime.sha256}`) {
    console.log(`${runtime.target}: ${CRAFT_VERSION} is already here`)
    continue
  }
  const url = `https://github.com/craft-native/craft/releases/download/${CRAFT_VERSION}/${runtime.asset}`
  const response = await fetch(url)
  if (!response.ok)
    throw new Error(`${runtime.asset}: ${response.status} from ${url}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  // A file that is not the one this was pinned to is not unpacked, whatever it is.
  if (sha256 !== runtime.sha256)
    throw new Error(`${runtime.asset}: checksum ${sha256} is not the pinned ${runtime.sha256}`)
  rmSync(directory, { recursive: true, force: true })
  mkdirSync(directory, { recursive: true })
  const archive = join(directory, runtime.asset)
  writeFileSync(archive, bytes)
  const unpacked = Bun.spawnSync(['unzip', '-oq', archive, '-d', directory])
  if (unpacked.exitCode !== 0)
    throw new Error(`${runtime.asset}: unzip failed: ${unpacked.stderr.toString().trim()}`)
  rmSync(archive)
  if (!existsSync(join(directory, runtime.expect)))
    throw new Error(`${runtime.asset}: no ${runtime.expect} inside`)
  writeFileSync(stamp, `${CRAFT_VERSION} ${runtime.sha256}`)
  console.log(`${runtime.target}: fetched Craft ${CRAFT_VERSION}`)
}
process.exit(0)
