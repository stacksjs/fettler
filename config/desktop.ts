import type { DesktopConfig } from '@stacksjs/types'

/**
 * Fettler as a desktop app: a compiled agent on 127.0.0.1 and a Craft web
 * view window pointed at it, the same on macOS, Windows and Linux.
 *
 * The agent module (app/Desktop/Agent.ts) answers /__fettler/* and is where
 * every child process lives: sessions on targets, the language server, log
 * follows. The window holds no credentials and spawns nothing.
 */
export default {
  webview: {
    appName: 'Fettler',
    appId: 'org.fettler.app',
    description: 'Run TypeScript against your app, here or on a server.',
    homepage: 'https://fettler.org',
    window: { width: 1280, height: 800 },
    agent: {
      entry: 'app/Desktop/Agent.ts',
      views: 'resources/desktop',
      // The component library answers first on desktop screens. The framework
      // defaults ship dashboard components under some of the same names (their
      // own CodeEditor among them), and these screens want the library's.
      components: ['node_modules/@stacksjs/components/src/ui', 'resources/desktop/components'],
      // An AI tool's door: its own bearer token, not the window's cookie.
      publicPaths: ['/__fettler/mcp'],
    },
    urlSchemes: ['fettler'],
    // Signed update manifests. The private half of this key is DESKTOP_UPDATE_PRIVATE_KEY and never ships.
    updates: {
      feedUrl: 'https://fettler.org/api/updates',
      publicKeys: { main: 'ed25519-public:MCowBQYDK2VwAyEAlJQdc7QeXJPeFKtsh2MkL12IDft7emqNu8vpOz-8bIQ' },
    },
    linux: { categories: ['Development'] },
  },
} satisfies DesktopConfig
