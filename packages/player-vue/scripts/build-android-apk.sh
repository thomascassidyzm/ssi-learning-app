#!/usr/bin/env bash
#
# build-android-apk.sh — the ONE way to make an installable Android debug APK.
#
# WHY THIS SCRIPT EXISTS (2026-09-05). The APK published to popty.app/builds as
# `local-5e99196` was built by hand: `vite build`, `cap sync`, `assembleDebug`.
# Every step succeeded and the artefact was dead. The build ran on a box with no
# VITE_SUPABASE_* variables set, so the bundle carried an empty Supabase url and
# anon key, no Supabase client was ever created, and the installed app rendered
# its transport bar and spun on a blank screen forever. Vercel supplies those
# variables from project settings; a local build has nobody to supply them, and
# nothing asked.
#
# The vite config now REFUSES that build (shippableWebviewBuildGuard). This
# script is the other half: it sources the config, names the api origin, and
# prints the stamp out of the artefact so the person holding the phone can tell
# which build they installed.
#
# Usage:
#   scripts/build-android-apk.sh [apiOrigin]
#
# Config: export VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY yourself, or drop
# them in an env file and point SSI_ENV_FILE at it. On watson-1 they live in
# ~/.secrets/ssi-dashboard.env (same Supabase project). The anon key is a public
# browser credential — it ships inside every deployed bundle already.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"

API_ORIGIN="${1:-https://ssi-learning-app-git-dev-zenjin.vercel.app}"
ENV_FILE="${SSI_ENV_FILE:-$HOME/.secrets/ssi-dashboard.env}"

if [ -z "${VITE_SUPABASE_URL:-}" ] && [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC2046
  export $(grep -E '^VITE_SUPABASE_(URL|ANON_KEY)=' "$ENV_FILE" | xargs -d '\n')
  echo "config: sourced VITE_SUPABASE_* from $ENV_FILE"
fi
export VITE_USE_DATABASE="${VITE_USE_DATABASE:-true}"
export VITE_APP_SHELL=webview

echo "==> building web bundle (shell=webview)"
pnpm --filter @ssi/core build
./node_modules/.bin/vite build

echo "==> stamping platform seam"
node scripts/injectPlatform.mjs dist/index.html "$API_ORIGIN"

echo "==> capacitor sync"
./node_modules/.bin/cap sync android

echo "==> gradle assembleDebug"
( cd android && ./gradlew --no-daemon assembleDebug )

APK=android/app/build/outputs/apk/debug/app-debug.apk
echo
echo "==> artefact"
echo "    path   : $HERE/$APK"
echo "    bytes  : $(stat -c%s "$APK")"
echo "    sha256 : $(sha256sum "$APK" | cut -d' ' -f1)"
echo "    stamp  : $(cat dist/version.json)"
echo "    apiOrigin: $API_ORIGIN"
echo
echo "The Settings build row will read the buildNumber above, rendered in the"
echo "device's own timezone. If it does not, you installed a different file."
