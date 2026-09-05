import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Capacitor wrapper for the SSi learner app — Android, DEBUG ONLY.
 *
 * APPLICATION ID IS DELIBERATELY LOCAL. `com.saysomethingin.devwrap` is a
 * throwaway dev identifier. It is NOT `com.automagic.a3f`, the live published
 * listing — whether the real build ever takes that id (which would update the
 * app under every existing user of it) or ships as a new package is Tom's
 * decision and is irreversible. Nothing here presumes it.
 *
 * The WebView serves the built PWA from its own origin (`https://localhost` on
 * Android, Capacitor's convention). That origin serves no API, so the app's
 * `/api/...` requests are pointed at a real deployment by
 * `window.__SSI_PLATFORM__`, injected into the built index.html by
 * `scripts/injectPlatform.mjs`. See src/platform/capabilities.ts.
 */
const config: CapacitorConfig = {
  appId: 'com.saysomethingin.devwrap',
  appName: 'SSi (dev wrap)',
  webDir: 'dist',
  android: {
    // Debug builds only. Cleartext stays off — the API origin is https.
    allowMixedContent: false,
  },
  plugins: {
    /**
     * INSET HANDLING IS DECLARED, NOT INHERITED. 'css' is already Capacitor
     * 8's default, and it is written down here because the app's whole
     * bottom-chrome clearance depends on it: with 'css' the SystemBars plugin
     * sets `--safe-area-inset-*` on documentElement in dp, which is the only
     * source that reports correctly in BOTH of its postures — the one where
     * it pads the WebView out of the system bars (and env() legitimately
     * reads 0), and the one where the WebView draws edge-to-edge and env() is
     * live. 'disable' would leave the app with no inset source at all and the
     * bottom controls back inside the navigation bar.
     *
     * See src/platform/shellSafeArea.ts and --shell-nav-clearance in
     * src/styles/design-tokens.css.
     */
    SystemBars: {
      insetsHandling: 'css',
    },
  },
}

export default config
