import { response, route } from '@stacksjs/router'

/**
 * Routes only the desktop app serves. They run inside the app, on 127.0.0.1,
 * next to everything in routes/ - which is mounted as `app/Routes.ts` says
 * (`routes/api.ts` under /api). These are not prefixed: write the full path.
 *
 * Whatever this file imports is compiled into the built app.
 */
route.get('/api/desktop/status', () => response.json({ app: "Fettler", ok: true }))
