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

/**
 * Which operating system a native shell is running on. Empty on the web and on
 * a shell that did not say — every consumer must treat '' as "unknown", never
 * as "android".
 */
export type ShellOs = '' | 'android' | 'ios'

export interface PlatformConfig {
  /** 'web' = a normal browser tab / installed PWA. 'webview' = a native shell. */
  shell: AppShell
  /**
   * Origin every `/api/...` request is sent to. EMPTY STRING on the web, which
   * means "same origin, relative path" — byte-identical to today's behaviour.
   * A WebView sets this because its own origin serves no API.
   */
  apiOrigin: string
  /**
   * The native shell's OS, stamped by the wrapper alongside `shell`. The web
   * never sets it. It exists for the ONE divergence found so far: update
   * delivery. On Android the newest build sits on popty.app/builds and the
   * staleness line may point there; on iOS builds arrive through TestFlight /
   * the App Store, which own that conversation entirely.
   */
  os: ShellOs
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

/**
 * How a WebView shell announces itself when it has nothing of ours to stamp.
 *
 * The bundled build injected `window.__SSI_PLATFORM__` into the index.html it
 * shipped. Since Tom's 2026-09-08 ruling the shell loads the DEPLOYMENT's
 * index.html, which we cannot stamp at build time, so the shell appends a
 * marker to the user agent instead — `appendUserAgent` in
 * capacitor.config.ts. Keep the two strings in step; capabilities.test.ts
 * pins this one.
 *
 * This is user-agent sniffing, which is usually a smell, and it is right here
 * for the reason the seam exists: it is ONE read, in the ONE door, of a string
 * WE control and put there ourselves. It is not a guess about a browser.
 */
export const SHELL_UA_MARKER = 'SSiShell/'

function readUserAgent(): string {
  try {
    return typeof navigator !== 'undefined' && typeof navigator.userAgent === 'string'
      ? navigator.userAgent
      : ''
  } catch {
    return ''
  }
}

/** `SSiShell/android` in the UA → { shell: 'webview', os: 'android' }. */
function readShellUserAgent(): Partial<PlatformConfig> {
  const ua = readUserAgent()
  const at = ua.indexOf(SHELL_UA_MARKER)
  if (at === -1) return {}
  const rest = ua.slice(at + SHELL_UA_MARKER.length)
  const os = rest.startsWith('ios') ? 'ios' : rest.startsWith('android') ? 'android' : ''
  return { shell: 'webview', os }
}

function detect(): PlatformConfig {
  const injected = readInjected()
  // The UA marker is the REMOTE shell's announcement; an injected stamp is the
  // bundled shell's. Injection wins where both are present, so a stamped build
  // behaves exactly as it did before this existed.
  const ua = readShellUserAgent()

  const shellRaw = String(injected.shell ?? readEnv('VITE_APP_SHELL') ?? '')
  const shell: AppShell = shellRaw === 'webview' || ua.shell === 'webview' ? 'webview' : 'web'

  const originRaw = String(injected.apiOrigin ?? readEnv('VITE_API_ORIGIN') ?? '')
  // Trailing slash off, so apiUrl() can concatenate a leading-slash path.
  const apiOrigin = originRaw.replace(/\/+$/, '')

  // `||` and not `??`: readEnv returns '' rather than undefined for an unset
  // variable, so a nullish chain would stop at the empty string and never
  // reach the user agent.
  const osRaw = String(injected.os || readEnv('VITE_APP_SHELL_OS') || ua.os || '')
  const os: ShellOs = osRaw === 'android' || osRaw === 'ios' ? osRaw : ''

  return { shell, apiOrigin, os }
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
    os: patch.os ?? current.os,
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
 * YES, EVERYWHERE, since Tom's ruling of 2026-09-08 — and in the WebView it is
 * now the load-bearing part rather than a redundancy.
 *
 * This answer used to be NO in a WebView, on the reasoning that "the native
 * shell owns caching and update delivery, and a Workbox precache underneath it
 * would serve its own stale app shell". That was correct while the APK bundled
 * its web assets: the shell really did own the code, and a precache of it was
 * a second frozen copy of a frozen copy. It is exactly backwards now. The
 * shell has no web assets at all; it is a window onto the deployment, so the
 * shell the service worker precaches IS the deployment's shell, and the
 * service worker is the ONLY thing that lets a learner open the app and play
 * with no network. Tom's requirement, in his own words: the service worker
 * caches the shell so regular play works offline after the first online open.
 *
 * Whether the browser actually supports one is vite-plugin-pwa's own check
 * inside registerSW, and deliberately not duplicated here.
 *
 * Note what the service worker does NOT do: audio. Audio lives in IndexedDB
 * under `ssi-audio-cache-v2` and has since SW audio caching was removed on
 * 2026-05-24 over iOS Range requests. The shell boots from the precache; the
 * lesson plays from IndexedDB.
 */
export function shouldRunServiceWorker(): boolean {
  return true
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
 * NO, ANYWHERE, since Tom's ruling of 2026-09-08. This line existed for one
 * structural reason and that reason is gone.
 *
 * The reason was: a bundled APK cannot notice new web code, because its own
 * /version.json is the frozen copy it shipped with — it asks itself and agrees
 * with itself forever — and no action its holder can take will fetch any. So
 * the lag was undetectable, and a visible sentence naming the only real
 * remedy, install a newer app, was the cure.
 *
 * A WebView onto the deployment has neither half of that. The code running IS
 * the deployment's code, so there is nothing to be behind; and where a newer
 * build genuinely is waiting, the service-worker update banner already owns
 * that ground and a reload genuinely resolves it, which is precisely why the
 * answer on the web has always been NO. Two surfaces describing one fact, one
 * of them telling the holder to go and install an app they already have, is
 * the class of lie this change exists to remove.
 *
 * The comparison machinery in buildStaleness.ts stays: SettingsScreen's
 * release-note check imports shaPrefixEq from it, and its three rules are
 * scars worth keeping.
 */
export function shouldDescribeStaleness(): boolean {
  return false
}

/**
 * Is a service worker API present at all? Diagnostics and cleanup paths ask
 * this — they must keep working on the web and quietly no-op where there is
 * no SW to inspect.
 */
export function hasServiceWorkerApi(): boolean {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator
}
