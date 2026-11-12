/**
 * What the window asks of the desktop shell around it, in one place.
 *
 * Inside the app that shell is Craft, which puts `craft` on the page: it opens
 * a second window by name and says when Settings was chosen from the app menu.
 * In a browser (development) there is no shell, so the Settings window is an
 * ordinary browser window and the menu is the keyboard shortcut alone.
 */

interface CraftShell {
  window?: { open?: (options: Record<string, unknown>) => Promise<unknown> }
  settings?: { onOpen?: (listener: () => void) => unknown }
}

function shell(): CraftShell | undefined {
  return (globalThis as { craft?: CraftShell }).craft
}

/** System Settings' own window: its sidebar is 250 wide, and it does not get narrower than both columns need. */
export const SETTINGS_WINDOW = { name: 'settings', title: 'Settings', width: 760, height: 560, minWidth: 700, minHeight: 440 }

/**
 * Open Settings, or bring it forward if it is open. The name is what makes a
 * second Cmd+, raise the window instead of stacking another behind it.
 */
export async function openSettingsWindow(pane?: string): Promise<void> {
  const url = `${globalThis.location.origin}/settings${pane ? `#${encodeURIComponent(pane)}` : ''}`
  const craft = shell()
  if (craft?.window?.open) {
    await craft.window.open({
      ...SETTINGS_WINDOW,
      url,
      titlebarHidden: true,
      webSidebarMaterial: true,
      webSidebarWidth: 250,
      resizable: true,
    })
    return
  }
  globalThis.open(url, 'tinkerbelle-settings', `popup,width=${SETTINGS_WINDOW.width},height=${SETTINGS_WINDOW.height}`)
}

/** Run `listener` when Settings is chosen from the app menu. Returns what stops listening. */
export function onSettingsRequested(listener: () => void): () => void {
  const heard = (): void => listener()
  const craft = shell()
  if (craft?.settings?.onOpen)
    craft.settings.onOpen(heard)
  else
    globalThis.addEventListener('craft:settings:open', heard)
  return () => globalThis.removeEventListener('craft:settings:open', heard)
}

const CHANNEL = 'tinkerbelle-preferences'

/** Tell the app's other windows that preferences changed, so they apply them now and not at their next focus. */
export function announcePreferences(preferences: unknown): void {
  if (typeof BroadcastChannel === 'undefined')
    return
  const channel = new BroadcastChannel(CHANNEL)
  channel.postMessage(preferences)
  channel.close()
}

/** Hear what another window changed. Returns what stops listening. */
export function onPreferences(listener: (preferences: unknown) => void): () => void {
  if (typeof BroadcastChannel === 'undefined')
    return () => {}
  const channel = new BroadcastChannel(CHANNEL)
  channel.onmessage = event => listener(event.data)
  return () => channel.close()
}
