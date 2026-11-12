#!/usr/bin/env bun
/**
 * Makes the installers for a desktop build that was compiled on another
 * machine: `bun bin/package-desktop.ts <folder with craft-package.json>`.
 *
 * Bun compiles the Windows app on any machine, but the MSI needs WiX, which
 * only runs on Windows. The build writes `craft-package.json` beside the
 * executables with paths relative to itself, so the folder can be carried to
 * a Windows machine and packaged there without the project around it.
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { packageApp } from 'craft-native'

const directory = resolve(process.argv[2] ?? '.')
process.chdir(directory)
const config = JSON.parse(readFileSync('craft-package.json', 'utf8'))

// The file names paths relative to itself. They are made whole here, because the
// tools that make an installer run in a folder of their own: a relative output
// path would put the MSI there, where it is thrown away with the rest.
const whole = (value: unknown): unknown => typeof value === 'string' && value.startsWith('./') ? resolve(directory, value) : value
for (const key of ['binaryPath', 'iconPath', 'outDir'])
  config[key] = whole(config[key])
for (const platform of ['windows', 'linux', 'macos']) {
  const files = config[platform]?.additionalFiles
  if (Array.isArray(files))
    config[platform].additionalFiles = files.map(whole)
}
let failed = false
for (const result of await packageApp(config)) {
  if (result.success && result.outputPath && existsSync(result.outputPath)) {
    console.log(`${result.format}: ${result.outputPath}`)
  }
  else if (result.success) {
    // Reported as made, and not where it was said to be: that is a failure, whatever the tool's exit code was.
    failed = true
    console.error(`${result.format}: reported at ${result.outputPath}, but nothing is there`)
  }
  else {
    failed = true
    console.error(`${result.format} failed: ${result.error}`)
  }
}
process.exit(failed ? 1 : 0)
