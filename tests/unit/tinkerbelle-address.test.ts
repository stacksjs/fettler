import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { formerHosts, productionHost, productionOrigin } from '../../config/address'

const kept = { url: process.env.APP_URL, former: process.env.APP_FORMER_DOMAINS }
afterEach(() => {
  for (const [name, value] of [['APP_URL', kept.url], ['APP_FORMER_DOMAINS', kept.former]] as const) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

function project(env: string): string {
  const root = mkdtempSync(join(tmpdir(), 'address-'))
  writeFileSync(join(root, '.env.production'), env)
  return root
}

describe('the production address', () => {
  test('is APP_URL when that is a public address', () => {
    process.env.APP_URL = 'https://example.app/'
    expect(productionHost(project('APP_URL=https://other.example\n'))).toBe('example.app')
    expect(productionOrigin(project(''))).toBe('https://example.app')
  })

  test('is the production file\'s when this machine\'s own is a development name', () => {
    process.env.APP_URL = 'tinkerbelle.localhost'
    expect(productionOrigin(project('APP_NAME=x\nAPP_URL="https://example.app"\n'))).toBe('https://example.app')
  })

  test('an encrypted value with no key to open it is not an address', () => {
    process.env.APP_URL = 'tinkerbelle.localhost'
    expect(productionHost(project('APP_URL="encrypted:v2:abc"\n'))).toBe('')
    expect(productionOrigin(project('APP_URL="encrypted:v2:abc"\n'))).toBe('http://localhost')
  })

  test('former domains redirect, and the current one is never among them', () => {
    process.env.APP_URL = 'https://example.app'
    delete process.env.APP_FORMER_DOMAINS
    expect(formerHosts(project('APP_FORMER_DOMAINS=old.example, example.app,https://older.example/\n'))).toEqual(['old.example', 'older.example'])
    expect(formerHosts(project(''))).toEqual([])
  })
})
