import type { DesktopConfig } from '@stacksjs/types'
import { productionOrigin } from './address'

// One address, from APP_URL: the app's home page and where it asks for updates.
const origin = productionOrigin()

/**
 * TinkerBelle as a desktop app: a compiled agent on 127.0.0.1 and a Craft web
 * view window pointed at it, the same on macOS, Windows and Linux.
 *
 * The agent module (app/Desktop/Agent.ts) answers /__tinkerbelle/* and is where
 * every child process lives: sessions on targets, the language server, log
 * follows. The window holds no credentials and spawns nothing.
 */
export default {
  webview: {
    appName: 'TinkerBelle',
    appId: 'app.tinkerbelle.desktop',
    description: 'Run TypeScript against your app, here or on a server.',
    homepage: origin,
    // 1024 pixels square; the build makes each platform's icon from it.
    icon: 'resources/brand/app-icon.png',
    window: { width: 1280, height: 800 },
    agent: {
      entry: 'app/Desktop/Agent.ts',
      views: 'resources/desktop',
      // The component library answers first on desktop screens. The framework
      // defaults ship dashboard components under some of the same names (their
      // own CodeEditor among them), and these screens want the library's.
      components: ['node_modules/@stacksjs/components/src/ui', 'resources/desktop/components'],
      // An AI tool's door: its own bearer token, not the window's cookie.
      publicPaths: ['/__tinkerbelle/mcp'],
    },
    urlSchemes: ['tinkerbelle'],
    // Signed update manifests. The private half of this key is DESKTOP_UPDATE_PRIVATE_KEY and never ships.
    updates: {
      feedUrl: `${origin}/api/updates`,
      publicKeys: { main: 'ed25519-public:MCowBQYDK2VwAyEAlJQdc7QeXJPeFKtsh2MkL12IDft7emqNu8vpOz-8bIQ' },
    },
    linux: { categories: ['Development'] },
  },
} satisfies DesktopConfig
