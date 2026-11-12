import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

/**
 * The environment a session's process starts with.
 *
 * A session runs someone else's project, so it must not inherit what TinkerBelle
 * loaded for itself. Bun reads `.env` files from the directory it starts in,
 * and a variable that is already set wins over a project's own file: without
 * this, a project opened from a development checkout of TinkerBelle would see
 * TinkerBelle's APP_NAME, database and keys instead of its own.
 */

const ENV_FILES = ['.env', '.env.local', '.env.development', '.env.development.local', '.env.production', '.env.test']

/** The variable names declared in an app's env files. Names only: values are never read into anything. */
export function declaredEnvKeys(root: string): Set<string> {
  const keys = new Set<string>()
  for (const name of ENV_FILES) {
    const file = join(root, name)
    if (!existsSync(file))
      continue
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const match = /^\s*(?:export\s+)?([A-Z_]\w*)\s*=/i.exec(line)
      if (match)
        keys.add(match[1]!)
    }
  }
  return keys
}

/** `base` without the variables an app declared for itself, plus `extra`. */
export function sessionEnvironment(ownKeys: Set<string>, extra: Record<string, string | undefined> = {}, base: Record<string, string | undefined> = process.env): Record<string, string | undefined> {
  const environment: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(base)) {
    if (!ownKeys.has(key))
      environment[key] = value
  }
  return { ...environment, ...extra }
}
