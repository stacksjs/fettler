import type { CloudConfig } from '@stacksjs/types'
import type { CloudConfig as TsCloudConfig } from '@stacksjs/ts-cloud'
import { formerHosts, productionHost } from './address'

// The deployment's identity on the server, not its name or address: the units, the gateway
// fragment and the data folder are called this. It predates the app's name and stays, because a
// new slug is a new tenant with an empty database, while a new name or domain is only APP_URL.
const slug = 'fettler'
// The address is APP_URL (config/address.ts). Changing it there moves the site: the next deploy
// publishes DNS for the new name, issues its certificates and routes it. A name listed in
// APP_FORMER_DOMAINS keeps answering and redirects here.
const domain = productionHost()
const former = Object.fromEntries(formerHosts().flatMap(host => [host, `www.${host}`]).map((host, index) => [`former${index}`, { domain: host, path: '/', redirect: { to: `https://${domain}`, preservePath: true } }]))
// Read from `ss -lntp` on the attached host on November 12, 2026: nothing bound 3500 to 3508.
const webPort = 3500
const apiPort = 3508
// Outside the atomic releases, so a deploy keeps the database and every published desktop build.
const data = `/var/lib/${slug}`
// Kept off the server: desktop builds are published to the data folder, not shipped inside a release.
const exclude = ['storage/app', 'storage/framework/desktop', 'spikes']
const runtime = {
  HOST: '127.0.0.1',
  APP_ENV: 'production',
  NODE_ENV: 'production',
  APP_NAME: 'TinkerBelle',
  APP_URL: `https://${domain}`,
  APP_DOMAIN: domain,
  // The site mounts what it serves by name in routes/: the update feed, and checkout when it opens.
  STACKS_DEFAULT_ROUTES: 'none',
  STACKS_MODEL_APIS: 'none',
  DB_CONNECTION: 'sqlite',
  DB_DATABASE: `${data}/${slug}.sqlite`,
  DB_DATABASE_PATH: `${data}/${slug}.sqlite`,
  DB_SNAPSHOT_PATH: `${data}/db-snapshot`,
  // Desktop builds live on the local disk under ${data}/storage/app/desktop-updates.
  STORAGE_DRIVER: 'local',
  STORAGE_ROOT: data,
  MAIL_MAILER: 'log',
}

/** A tenant on the shared Stacks box. It owns only what its slug names; the host never checks out this source. */
export const tsCloud: TsCloudConfig = {
  project: { name: slug, slug, region: 'us-east-1' },
  stateDir: 'storage/cloud',
  cloud: { provider: 'hetzner', attachTo: 'stacks' },
  mode: 'server',
  environments: {
    production: { type: 'production', deployBranch: 'main', region: 'us-east-1', variables: { APP_ENV: 'production', NODE_ENV: 'production', LOG_LEVEL: 'info' } },
  },
  infrastructure: {
    dns: { provider: 'porkbun', domain },
    compute: { instances: 1, size: 'small', disk: { size: 20, type: 'ssd', encrypted: true }, webServer: 'rpx', proxy: { engine: 'rpx', onDemandTls: true } },
  },
  sites: {
    // The API first: pages may call what it serves.
    api: {
      root: '.',
      start: 'bun node_modules/@stacksjs/actions/dist/serve/api.js',
      port: apiPort,
      preStart: ['bun install --frozen-lockfile'],
      exclude,
      env: { ...runtime },
    },
    main: {
      root: '.',
      path: '/',
      domain,
      start: 'bun node_modules/@stacksjs/buddy/dist/serve-entry.js',
      port: webPort,
      preStart: [
        'bun install --frozen-lockfile',
        `mkdir -p ${data}/db-snapshot ${data}/storage/app`,
        'bun node_modules/@stacksjs/buddy/dist/cli.js migrate --no-generate',
      ],
      exclude,
      env: { ...runtime, PORT_API: String(apiPort), API_URL: `http://127.0.0.1:${apiPort}` },
    },
    www: { domain: `www.${domain}`, path: '/', redirect: { to: `https://${domain}`, preservePath: true } },
    ...former,
  },
}

const config: CloudConfig = {}

export default config
