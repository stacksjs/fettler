/**
 * What the window asks of the desktop shell around it, in one place.
 *
 * Inside the app that shell is Craft, which puts `craft` on the page: it opens
 * a second window by name and says when Settings was chosen from the app menu.
 * In a browser (development) there is no shell, so the Settings window is an
 * ordinary browser window and the menu is the keyboard shortcut alone.
 */

interface CraftShell {
  window?: { open?: (options: Record<string, unknown>) => Promise<unknown>, startDrag?: () => unknown, maximize?: () => unknown }
  settings?: { onOpen?: (listener: () => void) => unknown }
  app?: { quit?: () => unknown }
  shell?: { openExternal?: (url: string) => unknown }
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

/**
 * Finish an update that is in place. The launcher starts the new version
 * once the window has closed, so restarting is quitting: the app comes back
 * by itself, as the version that was installed.
 */
export async function restartToFinishUpdate(): Promise<boolean> {
  const quit = shell()?.app?.quit
  if (typeof quit !== 'function')
    return false
  await quit()
  return true
}

/**
 * Open a page of the app's website in the person's browser, never in the app's
 * own window. Only an https address is opened: a link is the one thing here
 * that leaves the app, so it is held to the kind of address a website has.
 */
export async function openExternal(url: string): Promise<boolean> {
  let address: URL
  try {
    address = new URL(url)
  }
  catch {
    return false
  }
  if (address.protocol !== 'https:')
    return false
  const open = shell()?.shell?.openExternal
  if (typeof open === 'function')
    await open(address.href)
  else
    globalThis.open(address.href, '_blank', 'noopener,noreferrer')
  return true
}

/** The modifier key's name on this computer: the Command sign on a Mac, Ctrl elsewhere. */
export function modifierKey(platform: string = globalThis.navigator?.platform ?? ''): string {
  return /mac|iphone|ipad/i.test(platform) ? '\u2318' : 'Ctrl'
}

/** A shortcut as the keys to show: `['mod', 'Enter']` is Command and Return on a Mac, Ctrl and Enter elsewhere. */
export function shortcutKeys(keys: string[], platform: string = globalThis.navigator?.platform ?? ''): string[] {
  const mac = /mac|iphone|ipad/i.test(platform)
  const names: Record<string, string> = mac
    ? { mod: '\u2318', alt: '\u2325', shift: '\u21E7', enter: '\u21A9', escape: 'esc', tab: '\u21E5' }
    : { mod: 'Ctrl', alt: 'Alt', shift: 'Shift', enter: 'Enter', escape: 'Esc', tab: 'Tab' }
  return keys.map(key => names[key.toLowerCase()] ?? key)
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

/** Tell the app's other windows that something other than a preference changed (the AI key, a license), so they read it again. */
export function announceChange(): void {
  announcePreferences({ changed: true })
}

/** Hear what another window changed. Returns what stops listening. */
export function onPreferences(listener: (preferences: unknown) => void): () => void {
  if (typeof BroadcastChannel === 'undefined')
    return () => {}
  const channel = new BroadcastChannel(CHANNEL)
  channel.onmessage = event => listener(event.data)
  return () => channel.close()
}

/**
 * Let the parts of the page matching `selector` move the window, the way a
 * title bar does. The window has no title bar of its own, and the web view
 * ignores the CSS that would make a region draggable, so a press on an empty
 * part of the bar is handed to the shell, which runs a real window drag from
 * it. A double click zooms the window, as it does on a title bar.
 */
export function dragWindowFrom(selector: string): void {
  const isHandle = (target: EventTarget | null): boolean => {
    if (!(target instanceof Element))
      return false
    // Anything that can be pressed is not a handle, or a click released a pixel off would move the window.
    if (target.closest('button, a, input, select, textarea, [role="button"], [role="tab"]'))
      return false
    return Boolean(target.closest(selector))
  }
  globalThis.addEventListener('mousedown', (event) => {
    if ((event as MouseEvent).button === 0 && isHandle(event.target))
      void shell()?.window?.startDrag?.()
  })
  globalThis.addEventListener('dblclick', (event) => {
    if (isHandle(event.target))
      void shell()?.window?.maximize?.()
  })
}
