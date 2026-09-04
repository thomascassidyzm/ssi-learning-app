/**
 * capabilities — the ONE place that answers "what am I running inside, and
 * what can it do".
 *
 * Why this module exists at all: the app is about to be loaded inside an
 * Android WebView as well as served from saysomethingin.app, and the way that
 * is always lost is the same — `if (nativeShell)` sprinkled through a hundred
 * files until nobody can reason about either platform. So there is exactly
 * one door. Everything else imports from here; nothing else reads the
 * environment, sniffs a global, or decides for itself. `platformDoors.test.ts`
 * fails the build if a second door appears.
 *
 * DEFAULT IS THE WEB, UNCHANGED. With nothing configured the shell is 'web',
 * the API origin is the empty string (so every request stays the same
 * relative path it is today), and the service worker registers exactly as it
 * always has. A WebView build changes those by configuration, not by code.
 *
 * NAMING: do not call anything here `isNative` — `isNativeScript` already
 * exists in this codebase and means "show the target text in its own writing
 * system", which has nothing to do with platforms. The shell is `shell`, and
 * the native case is `'webview'`.
 */

/** Which container the app is running in. */
export type AppShell = 'web' | 'webview'

export interface PlatformConfig {
  /** 'web' = a normal browser tab / installed PWA. 'webview' = a native shell. */
  shell: AppShell
  /**
   * Origin every `/api/...` request is sent to. EMPTY STRING on the web, which
   * means "same origin, relative path" — byte-identical to today's behaviour.
   * A WebView sets this because its own origin serves no API.
   */
  apiOrigin: string
}

/**
 * Runtime injection point for a native shell: the wrapper sets
 * `window.__SSI_PLATFORM__ = { shell: 'webview', apiOrigin: 'https://…' }`
 * before the app bundle evaluates. Build-time VITE_ vars cover the case where
 * the shell gets its own build instead.
 */
declare global {
  interface Window {
    __SSI_PLATFORM__?: Partial<PlatformConfig>
  }
}

function readEnv(key: string): string {
  try {
    const env = (import.meta as any)?.env
    const v = env?.[key]
    return typeof v === 'string' ? v.trim() : ''
  } catch {
    return ''
  }
}

function readInjected(): Partial<PlatformConfig> {
  try {
    return (typeof window !== 'undefined' && window.__SSI_PLATFORM__) || {}
  } catch {
    return {}
  }
}

function detect(): PlatformConfig {
  const injected = readInjected()
  const shellRaw = String(injected.shell ?? readEnv('VITE_APP_SHELL') ?? '')
  const shell: AppShell = shellRaw === 'webview' ? 'webview' : 'web'

  const originRaw = String(injected.apiOrigin ?? readEnv('VITE_API_ORIGIN') ?? '')
  // Trailing slash off, so apiUrl() can concatenate a leading-slash path.
  const apiOrigin = originRaw.replace(/\/+$/, '')

  return { shell, apiOrigin }
}

let current: PlatformConfig = detect()

/** The live platform configuration. */
export function platform(): Readonly<PlatformConfig> {
  return current
}

/**
 * Override the detected configuration. For the native shell's bootstrap and
 * for tests; the web never calls it. Returns the new config.
 */
export function configurePlatform(patch: Partial<PlatformConfig>): Readonly<PlatformConfig> {
  current = {
    shell: patch.shell ?? current.shell,
    apiOrigin: (patch.apiOrigin ?? current.apiOrigin).replace(/\/+$/, ''),
  }
  return current
}

/** Re-read the environment. Tests use this to get back to a clean slate. */
export function resetPlatform(): Readonly<PlatformConfig> {
  current = detect()
  return current
}

/** True inside a native shell's WebView. Never true on the web. */
export function isNativeShell(): boolean {
  return current.shell === 'webview'
}

/**
 * Should this build run a Workbox service worker at all?
 *
 * On the web: YES, unconditionally — byte-identical to today. Whether the
 * browser actually supports one is vite-plugin-pwa's own check inside
 * registerSW, and deliberately not duplicated here: duplicating it would
 * change web behaviour in browsers that have no service worker, which is
 * exactly what this seam must not do.
 *
 * In a WebView: NO. The native shell owns caching and update delivery; a
 * Workbox precache underneath it is redundant at best and, because it would
 * serve its own stale app shell, actively harmful.
 */
export function shouldRunServiceWorker(): boolean {
  return current.shell !== 'webview'
}

/**
 * Should this build ever offer the learner "install this app"?
 *
 * On the web: YES. The PWA install banner, the /install guide and the org
 * lane's install walk are all unchanged.
 *
 * In a WebView: NO. The learner has ALREADY installed the app — that is how
 * they are reading this — so an add-to-home-screen offer is at best noise and
 * at worst an instruction to install a second copy. Tom, seeing it on the
 * first Android build, 2026-09-04: "we want to suppress this install pop up
 * presumably!!!"
 *
 * Note this is NOT the same question as "did beforeinstallprompt fire". The
 * banner's own gate was `display-mode: standalone`, which is FALSE inside a
 * WebView, so the banner appeared without any prompt event at all. The
 * question the callers actually have is this one, so this is the one the seam
 * answers.
 */
export function shouldOfferAppInstall(): boolean {
  return current.shell !== 'webview'
}

/**
 * Should this build DESCRIBE its own staleness — "this app is from {date}, a
 * newer version exists"?
 *
 * In a WebView: YES. The APK bundles its web assets, so nothing inside it can
 * notice new code by itself and no action its holder takes will fetch any: the
 * only remedy is installing a new app. Left silent, that lag is undetectable,
 * which is exactly what happened to the build Tom was testing on 2026-09-04.
 *
 * On the web: NO. The service-worker update banner already owns this ground,
 * a reload genuinely resolves it, and a line telling a browser user to go and
 * install an app would be false. Web behaviour is unchanged.
 *
 * Note this is NOT `isNativeShell()` wearing a different hat, for the same
 * reason `shouldOfferAppInstall()` is not: the question a caller has is this
 * one, so this is the one the seam answers.
 */
export function shouldDescribeStaleness(): boolean {
  return current.shell === 'webview'
}

/**
 * Is a service worker API present at all? Diagnostics and cleanup paths ask
 * this — they must keep working on the web and quietly no-op where there is
 * no SW to inspect.
 */
export function hasServiceWorkerApi(): boolean {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator
}
