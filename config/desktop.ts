import type { DesktopConfig } from '@stacksjs/types'

/**
 * The Mac app: the stx screens in resources/native, drawn by Craft's AppKit
 * host (no web view), with this project's API running inside the app.
 *
 * `agent: true` starts the routes on 127.0.0.1 when the app opens and points
 * the window at them: `routes/api.ts` (under /api) and the agent's own routes
 * in app/Desktop/Agent.ts. Only the app's own window can call them.
 *
 * `bun run dev:desktop` builds the screens and opens the app;
 * `bun run build:desktop` builds a signed `.app` in storage/framework/desktop/macos.
 */
export default {
  macos: {
    appName: "Fettler",
    bundleId: "com.example.fettler",
    agent: true,
    nativeScreens: ['Main'],
    window: { width: 1100, height: 720, minWidth: 720, minHeight: 480 },
  },
} satisfies DesktopConfig
