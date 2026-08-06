/**
 * installPlatform — one place that answers "what does installing look like on
 * THIS device?", so the two surfaces that ask can never disagree.
 *
 * The full walkthrough lives in views/InstallGuide.vue (route /install). The
 * org lane needed the same question answered inline — a manager who has just
 * set a password gets a nudge to install, right there on their own node,
 * without being thrown out of the organisation they are building. Rather than
 * a second copy of the user-agent sniffing, both read from here.
 *
 * Founder framing (Tom, 2026-08-06): "a context aware install as PWA, on a
 * desktop likely to be a chrome app". Desktop says APP; mobile says HOME
 * SCREEN. Same act, two different words, because those are the words the two
 * platforms actually use.
 */

export type InstallSurface = 'ios' | 'android' | 'desktop'

export interface InstallPlatform {
  isIOS: boolean
  isAndroid: boolean
  isSafari: boolean
  isChrome: boolean
  isStandalone: boolean
  /** Which set of instructions applies. 'installed' is a state, not a surface. */
  surface: InstallSurface
}

export interface DetectInput {
  ua: string
  standalone: boolean
}

/**
 * Pure detection — takes the user agent and the standalone flag rather than
 * reading globals, so it is testable without a browser.
 */
export function detectInstallPlatform({ ua, standalone }: DetectInput): InstallPlatform {
  const isIOS = /iPad|iPhone|iPod/.test(ua)
  const isAndroid = /Android/.test(ua)
  const isSafari = /Safari/.test(ua) && !/Chrome/.test(ua)
  const isChrome = /Chrome/.test(ua) && !/Edg/.test(ua)
  return {
    isIOS,
    isAndroid,
    isSafari,
    isChrome,
    isStandalone: standalone,
    surface: isIOS ? 'ios' : isAndroid ? 'android' : 'desktop',
  }
}

/** Read the live browser. Guarded so it is safe under SSR/unit environments. */
export function readStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const displayMode = typeof window.matchMedia === 'function'
    && window.matchMedia('(display-mode: standalone)').matches
  const iosStandalone = (window.navigator as unknown as { standalone?: boolean })?.standalone === true
  return !!displayMode || iosStandalone
}

export function detectFromBrowser(): InstallPlatform {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent
  return detectInstallPlatform({ ua, standalone: readStandalone() })
}

export interface InstallFraming {
  /** Headline for the nudge. */
  title: string
  /** One line saying what they get. */
  blurb: string
  /** Label on the button that does the install, when the browser offers one. */
  cta: string
  /** Label on the link out to the full walkthrough, when it doesn't. */
  guideCta: string
}

/**
 * The words, by surface. Desktop Chrome installs a PWA as an app in its own
 * window — Chrome itself calls it "Install"; the manager thinks of it as a
 * Chrome app. Mobile adds an icon to the home screen. Say the true thing on
 * each, and never the other one's word.
 */
export function installFraming(
  platform: Pick<InstallPlatform, 'surface' | 'isChrome'>,
): InstallFraming {
  if (platform.surface === 'desktop') {
    // Chrome is the overwhelming desktop case and calls it a Chrome app —
    // Tom's own words. Other desktop browsers get the honest generic wording.
    const chrome = platform.isChrome
    return {
      title: chrome ? 'Install it as a Chrome app' : 'Install it as an app',
      blurb: 'Your organisation opens in its own window, straight from your desktop — no hunting for a tab.',
      cta: chrome ? 'Install the Chrome app' : 'Install the app',
      guideCta: 'Show me how',
    }
  }
  return {
    title: 'Add it to your home screen',
    blurb: 'Your organisation opens with one tap, straight from your home screen.',
    cta: 'Add to home screen',
    guideCta: 'Show me how',
  }
}
