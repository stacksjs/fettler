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
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { packageApp } from 'craft-native'

const directory = resolve(process.argv[2] ?? '.')
process.chdir(directory)
const config = JSON.parse(readFileSync('craft-package.json', 'utf8'))
let failed = false
for (const result of await packageApp(config)) {
  if (result.success) {
    console.log(`${result.format}: ${result.outputPath}`)
  }
  else {
    failed = true
    console.error(`${result.format} failed: ${result.error}`)
  }
}
process.exit(failed ? 1 : 0)
