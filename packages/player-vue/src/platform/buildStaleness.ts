/**
 * buildStaleness — "is the code I am running older than the code that is live?"
 *
 * WHY THIS EXISTS, mechanically. The Capacitor wrapper bundles the whole built
 * PWA into the APK under `assets/public/` and serves it from the origin
 * `https://localhost` (verified from the APK's own bytes, job #525). Only
 * `/api/...` traffic leaves the device. So `fetchLatestBuildNumber()`'s
 * relative `fetch('/version.json')` — exactly right on the web, where it names
 * the deployment — resolves inside the APK to the FROZEN copy vite emitted into
 * `dist` at build time. It can only ever equal `__BUILD_NUMBER__`. The native
 * app is therefore structurally incapable of noticing it is behind: it asks
 * itself, and it agrees with itself, forever.
 *
 * Tom's ruling, 2026-09-04: keep the bundled assets — offline-first is what
 * India is buying, and pointing `server.url` at a remote origin would make
 * every APK a thin client of our uptime on exactly the bad networks the app
 * exists to survive. Cure the SILENT staleness instead, with a visible line.
 *
 * SUPERSEDED 2026-09-08. Tom reversed that ruling: the shell now points
 * `server.url` at the deployment and carries no web assets at all. His own
 * answer to the reasoning above is that you cannot fetch an update without a
 * network on ANY option, so needing one is a property of updating rather than
 * a cost of the remote posture — and what covers the learner between updates
 * is the service worker, which now runs inside the WebView precaching the
 * deployment's own shell. The bundled build's real cost was that "Tap to
 * update" could never fetch new web code: the button lied. So
 * `shouldDescribeStaleness()` is now false everywhere and the line above is
 * HISTORY, not law.
 *
 * The module stays, and so do the three rules below, which are scars rather
 * than scaffolding: `shaPrefixEq` is imported by SettingsScreen's release-note
 * comparison, and the rules hold for any future build-id comparison.
 *
 * THREE RULES, and every one of them is a scar.
 *
 * 1. DIFFERENT IS NOT NEWER. Two build ids that disagree tell you the builds
 *    are not the same; they say nothing about which came first. A local APK
 *    cut at 20:31 tonight is AHEAD of a deployment from this morning, and
 *    telling its holder to go and install an older build would be worse than
 *    silence. So staleness is decided on BUILD TIME, and the id comparison
 *    only ever short-circuits to "current".
 *
 * 2. SILENT WHEN UNSURE. No network, endpoint down, unparseable answer, no
 *    timestamps to compare — say nothing at all. This is the deliberate
 *    inverse of `isDifferentBuild()` in usePwaUpdate, which fails OPEN so the
 *    web's service-worker banner never swallows a real update. That is right
 *    for a banner the learner can act on with a reload, and wrong here: no
 *    action the holder of an APK can take will fetch new web code, so a false
 *    alarm sends them off to reinstall something they already have. A guard
 *    protects money and fails closed; a description protects nobody and stays
 *    quiet.
 *
 * 3. PREFIX-COMPARE THE IDS, NEVER `===`. `buildNumber` is a 7-char sha on
 *    Vercel, `local-<sha>` (and `local-<sha>-dirty`) from a local build, and
 *    release-note versions are stored at a different length again. Exact
 *    string equality on those is what produced a PERMANENT false "Update
 *    available" that tapping could not clear — see the comment above
 *    `noteIndicatesNewer` in SettingsScreen.vue, which is that bug's tombstone.
 *    `shaPrefixEq` lives here, and SettingsScreen imports it, so the two
 *    surfaces cannot drift into two different answers about one fact.
 */

/**
 * Compare two build ids on their shared prefix, so a 7-char sha and the 8-char
 * version the same commit is recorded under elsewhere still match.
 */
export function shaPrefixEq(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  const n = Math.min(a.length, b.length)
  return n > 0 && a.slice(0, n) === b.slice(0, n)
}

/**
 * Strip the local-build decoration down to the bare sha, so `local-1a2b3c4`,
 * `local-1a2b3c4-dirty` and the deployed `1a2b3c4` are recognised as one
 * commit. The `-dirty` marker is deliberately NOT preserved: a dirty tree is a
 * provenance fact for the Settings row to state, not a reason to tell someone
 * their app is out of date.
 */
export function normaliseBuildId(id: string | null | undefined): string {
  if (!id) return ''
  return id.replace(/^local-/, '').replace(/-dirty$/, '')
}

/** What `/version.json` carries. Either field may be absent on an old build. */
export interface BuildStamp {
  buildNumber?: string | null
  buildTime?: string | null
}

/** Five-minute tolerance, matching SettingsScreen's release-note comparison. */
const CLOCK_TOLERANCE_MS = 5 * 60 * 1000

/**
 * Is `running` provably older than `latest`?
 *
 * TRUE only when we can show it: the ids differ AND the live build's timestamp
 * is meaningfully later than ours. Every other case — including "we cannot
 * tell" — is false.
 */
export function isProvablyStale(running: BuildStamp, latest: BuildStamp | null | undefined): boolean {
  if (!latest) return false

  const runningId = normaliseBuildId(running.buildNumber)
  const latestId = normaliseBuildId(latest.buildNumber)
  // A build with no id of its own cannot be compared to anything.
  if (!runningId || !latestId) return false
  // Same commit — current, whatever the timestamps say (a rebuild of the same
  // tree gets a later buildTime and is NOT a newer version).
  if (shaPrefixEq(runningId, latestId)) return false

  // Different builds. Now prove which is older, or stay quiet.
  const ours = Date.parse(running.buildTime ?? '')
  const theirs = Date.parse(latest.buildTime ?? '')
  if (Number.isNaN(ours) || Number.isNaN(theirs)) return false
  return theirs > ours + CLOCK_TOLERANCE_MS
}
