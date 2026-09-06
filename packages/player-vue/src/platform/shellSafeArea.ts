/**
 * shellSafeArea — makes the measured system-bar insets real, and makes a
 * MISSING measurement visible instead of silent.
 *
 * Why this exists. Deborah, the first external Android tester, 2026-09-05:
 * "I do not like that the bottom controls are so close to my phone controls."
 * The app's floating bottom chrome derives from `--shell-nav-clearance`
 * (styles/design-tokens.css), which on the web and on iOS is half the safe
 * area — the native convention there. On Android that is wrong twice over,
 * so the Android native shell gets its own rule, and this module is the one
 * place that says "this is the Android native shell".
 *
 * It does exactly two things:
 *
 *  1. Sets `data-shell-android="1"` on <html>, which switches on that rule.
 *  2. Chooses the CLEARANCE FLOOR, which is the honest answer to an
 *     ambiguity CSS cannot resolve on its own. A measured bottom inset of
 *     zero means one of two opposite things:
 *       - Capacitor's SystemBars plugin has PADDED the WebView out of the
 *         system bars and zeroed the insets it passes on (Cap 8
 *         SystemBars.java, the non-passthrough branch on Android 15+). Zero
 *         is then correct and a small floor is all the chrome needs.
 *       - Nothing is reporting insets at all: the window is edge-to-edge and
 *         the chrome is sitting inside the navigation bar. Zero is then the
 *         bug, and it looks EXACTLY like the case above.
 *     The tell is whether an inset source exists, not what it reads. When
 *     Capacitor is handling insets it sets `--safe-area-inset-*` on
 *     documentElement; when a WebView reports insets natively, env() is
 *     non-zero somewhere. Seeing neither means nobody is measuring, and the
 *     floor goes conservative — tall enough to clear a three-button
 *     navigation bar (48dp) with a touch margin.
 *
 * NOT a second platform door: it asks platform/capabilities for the shell and
 * lives inside src/platform/ where the door scanner expects such questions.
 */

import { isNativeShell } from './capabilities'

/** Bottom clearance used when an inset source IS reporting (it may legitimately read 0). */
export const NAV_FLOOR_MEASURED = '24px'
/** Bottom clearance used when NO inset source is reporting: 48dp nav bar + 16px touch margin. */
export const NAV_FLOOR_UNMEASURED = '64px'

/** The four measured insets, in CSS pixels, as the shell currently reports them. */
export interface MeasuredInsets {
  top: number
  right: number
  bottom: number
  left: number
  /** True when some source (Capacitor's properties or native env()) is reporting. */
  reporting: boolean
  /** Where the numbers came from, for the diagnostic read-out. */
  source: 'capacitor' | 'env' | 'none'
}

/**
 * Pure: given what the shell reports, which floor should the chrome use?
 * `reporting` false means nobody is measuring — go conservative.
 */
export function chooseNavFloor(reporting: boolean): string {
  return reporting ? NAV_FLOOR_MEASURED : NAV_FLOOR_UNMEASURED
}

/** Pure: is this an Android user agent? */
export function isAndroidUserAgent(ua: string): boolean {
  return /android/i.test(ua)
}

/**
 * Pure: should the Android shell rule apply? Native shell AND Android — an
 * iOS WebView keeps the iOS convention it has always had.
 */
export function shouldApplyAndroidClearance(nativeShell: boolean, ua: string): boolean {
  return nativeShell && isAndroidUserAgent(ua)
}

function px(value: string): number {
  const n = parseFloat(value)
  return Number.isFinite(n) ? n : 0
}

/**
 * Read the insets the shell is currently reporting. Capacitor's injected
 * custom properties win where present — they are the only source that is
 * correct in BOTH of the plugin's postures.
 */
export function measureInsets(doc: Document = document): MeasuredInsets {
  const rootStyle = getComputedStyle(doc.documentElement)
  const cap = {
    top: rootStyle.getPropertyValue('--safe-area-inset-top').trim(),
    right: rootStyle.getPropertyValue('--safe-area-inset-right').trim(),
    bottom: rootStyle.getPropertyValue('--safe-area-inset-bottom').trim(),
    left: rootStyle.getPropertyValue('--safe-area-inset-left').trim(),
  }
  if (cap.bottom !== '' || cap.top !== '') {
    return {
      top: px(cap.top),
      right: px(cap.right),
      bottom: px(cap.bottom),
      left: px(cap.left),
      reporting: true,
      source: 'capacitor',
    }
  }

  // No Capacitor properties — read native env() through a probe element, the
  // only way to get env() values into JS.
  const probe = doc.createElement('div')
  probe.style.cssText =
    'position:fixed;left:-9999px;top:-9999px;width:0;height:0;' +
    'padding-top:env(safe-area-inset-top,0px);' +
    'padding-right:env(safe-area-inset-right,0px);' +
    'padding-bottom:env(safe-area-inset-bottom,0px);' +
    'padding-left:env(safe-area-inset-left,0px);'
  doc.body.appendChild(probe)
  const s = getComputedStyle(probe)
  const measured = {
    top: px(s.paddingTop),
    right: px(s.paddingRight),
    bottom: px(s.paddingBottom),
    left: px(s.paddingLeft),
  }
  probe.remove()

  const any = measured.top > 0 || measured.right > 0 || measured.bottom > 0 || measured.left > 0
  return { ...measured, reporting: any, source: any ? 'env' : 'none' }
}

/**
 * Apply the Android shell rule and settle the floor.
 *
 * The floor starts optimistic (24px) and only goes conservative if, after the
 * shell has had a chance to report, nothing has. Capacitor injects its
 * properties from a DOM-ready callback that can land after this module runs,
 * so a single synchronous read would misjudge it; we re-check on the usual
 * settling points and whenever the window geometry changes (rotation, a
 * navigation-mode switch, the keyboard).
 */
export function installShellSafeArea(win: Window = window): void {
  const doc = win.document
  const ua = win.navigator?.userAgent ?? ''
  if (!shouldApplyAndroidClearance(isNativeShell(), ua)) return

  const root = doc.documentElement
  root.setAttribute('data-shell-android', '1')
  root.style.setProperty('--shell-nav-floor', NAV_FLOOR_MEASURED)

  const settle = () => {
    const insets = measureInsets(doc)
    root.style.setProperty('--shell-nav-floor', chooseNavFloor(insets.reporting))
  }

  // Deliberately NOT called synchronously: Capacitor injects its properties
  // from a DOM-ready callback that lands after this, so a boot-time read would
  // report "nobody is measuring", jump the chrome to the conservative floor,
  // and jump it back a moment later. The first check waits for that callback.
  win.setTimeout(settle, 400)
  win.setTimeout(settle, 1500)
  win.addEventListener('resize', settle)
  win.addEventListener('orientationchange', settle)
}

/**
 * The measured insets as one short line for the Settings build card, or ''
 * when there is nothing to say.
 *
 * Lives here rather than in the component because this is a platform
 * question ("is this a native shell, and what is it reporting") and there is
 * exactly one door for those — platformDoors.test.ts enforces it. The
 * component renders a string it is handed and asks nothing.
 *
 * Empty on the web: a browser tab has no bundled shell whose inset plumbing
 * could silently fail, and the line would be noise on the one surface where
 * every learner sees it.
 */
export function insetDiagnosticLine(doc: Document = document): string {
  if (!isNativeShell()) return ''
  try {
    const i = measureInsets(doc)
    return `insets ${i.top}/${i.right}/${i.bottom}/${i.left} \u00b7 ${i.source}`
  } catch {
    return ''
  }
}
