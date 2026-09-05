/**
 * Which build-time config a WEBVIEW (APK) bundle cannot ship without.
 *
 * This is the build-time twin of `missingRequiredConfig()` in env.ts, and it
 * exists because the runtime one arrives too late. On the web a missing var is
 * a console error and one redeploy; inside an APK it is an artefact a human has
 * already installed, with no console they can read and no way to fix it from
 * here. The `local-5e99196` build published on 2026-09-05 was exactly that: no
 * VITE_SUPABASE_* on the building box, so no Supabase client, so the player
 * rendered its transport bar and spun on a blank screen forever.
 *
 * Consumed by `shippableWebviewBuildGuard()` in vite.config.js, which throws at
 * buildStart when this returns anything.
 */
export function missingWebviewBuildConfig(env) {
  const get = (k) => String(env[k] ?? '').trim()
  if (get('VITE_APP_SHELL') !== 'webview') return []
  // Builds made to be INSPECTED rather than installed (the payment-route
  // checks build a webview bundle purely to grep it) opt out explicitly.
  if (get('VITE_ALLOW_NO_SUPABASE') === '1') return []
  const missing = []
  if (!get('VITE_SUPABASE_URL')) missing.push('VITE_SUPABASE_URL')
  if (!get('VITE_SUPABASE_ANON_KEY')) missing.push('VITE_SUPABASE_ANON_KEY')
  if (get('VITE_USE_DATABASE') !== 'true') missing.push('VITE_USE_DATABASE (must be "true")')
  return missing
}
