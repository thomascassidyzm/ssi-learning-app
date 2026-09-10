#!/usr/bin/env bash
#
# build-android-apk.sh — the ONE way to make an installable Android debug APK.
#
# WHAT THIS BUILDS, SINCE TOM'S RULING OF 2026-09-08. A shell, and nothing but a
# shell. The APK no longer carries the web app: `server.url` in
# capacitor.config.ts points the WebView at a real deployment, so the code the
# learner runs is the code that is live, and "Tap to update" can actually fetch
# it. There is therefore NO vite build in this script and no Supabase
# configuration to get wrong — the two things that killed the `local-5e99196`
# artefact, which built cleanly with empty VITE_SUPABASE_* variables and
# installed as a dead app spinning on a blank screen. That whole failure mode
# is now structurally impossible here: those variables belong to the
# deployment's build, on Vercel, where something supplies them.
#
# `webDir` points at a generated one-page holding notice, written below. The
# WebView never reads it while the deployment is reachable; it exists because
# `cap sync` needs a web directory to copy, and a holding notice is a better
# thing to have in the APK than 823 frozen files of an app nobody loads.
#
# Usage:
#   scripts/build-android-apk.sh [origin]
#   SSI_SHELL_ORIGIN=<origin> scripts/build-android-apk.sh
#
# WHICH DEPLOYMENT THIS APK LOOKS AT, AND WHY THE DEFAULT IS STAGING. Tom's
# ruling, 2026-09-10: production is for live learners, so the only honest
# reason to point a test build at it is to fix a problem that is already live
# there — never to compare builds or platforms. An APK that lands on
# production because somebody forgot a variable is therefore always wrong, and
# an unset SSI_SHELL_ORIGIN yields STAGING. Production is one explicit word:
#
#   scripts/build-android-apk.sh https://saysomethingin.app
#
# The default itself is NOT written here. It is read out of
# capacitor.config.ts below, because that file is what the WebView actually
# obeys and a second copy of the answer in this script could only ever drift
# away from it and lie in the banner.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"

if [ "${1:-}" != "" ]; then
  export SSI_SHELL_ORIGIN="$1"
fi

# The single source of truth for the default, read from the file the WebView
# obeys. If this grep ever comes back empty the config has been restructured,
# and the right answer is to stop rather than to silently invent an origin.
SHELL_DEFAULT_ORIGIN="$(sed -n "s/^const SHELL_DEFAULT_ORIGIN = '\(.*\)'.*$/\1/p" capacitor.config.ts)"
if [ -z "$SHELL_DEFAULT_ORIGIN" ]; then
  echo "!! could not read SHELL_DEFAULT_ORIGIN from capacitor.config.ts." >&2
  echo "   Set SSI_SHELL_ORIGIN explicitly, or fix the constant, and run again." >&2
  exit 1
fi

if [ -n "${SSI_SHELL_ORIGIN:-}" ]; then
  SHELL_ORIGIN="$SSI_SHELL_ORIGIN"
  ORIGIN_SOURCE="chosen explicitly"
else
  SHELL_ORIGIN="$SHELL_DEFAULT_ORIGIN"
  ORIGIN_SOURCE="the default — nobody set SSI_SHELL_ORIGIN"
fi
SHELL_ORIGIN="${SHELL_ORIGIN%/}"

echo "==> shell origin: $SHELL_ORIGIN  ($ORIGIN_SOURCE)"

echo "==> writing the holding notice into android-shell-web/"
mkdir -p android-shell-web
cat > android-shell-web/index.html <<HTML
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>SaySomethingin</title>
    <style>
      body { margin: 0; display: grid; place-items: center; min-height: 100vh;
             background: #e8e3dd; color: #2b2b2b;
             font: 16px/1.5 system-ui, -apple-system, sans-serif; }
      main { max-width: 24rem; padding: 2rem; text-align: center; }
    </style>
  </head>
  <body>
    <main>
      <p>SaySomethingin is loading from ${SHELL_ORIGIN}.</p>
      <p>If you are seeing this page, the app could not reach it. Check your connection and open the app again.</p>
    </main>
  </body>
</html>
HTML

echo "==> capacitor sync"
./node_modules/.bin/cap sync android

# Neither JAVA_HOME nor ANDROID_HOME is exported on watson-1; gradle needs both
# and says so in two very different ways. Defaults point at where they live.
export JAVA_HOME="${JAVA_HOME:-$HOME/tools/jdk21}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/sdk}"
export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$ANDROID_HOME}"
export PATH="$JAVA_HOME/bin:$PATH"

echo "==> gradle assembleDebug (java: $JAVA_HOME, sdk: $ANDROID_HOME)"
( cd android && ./gradlew --no-daemon assembleDebug )

APK=android/app/build/outputs/apk/debug/app-debug.apk
echo
echo "==> artefact"
echo "    path   : $HERE/$APK"
echo "    bytes  : $(stat -c%s "$APK")"
echo "    sha256 : $(sha256sum "$APK" | cut -d' ' -f1)"
echo "    origin : $SHELL_ORIGIN  ($ORIGIN_SOURCE)"
echo "    serving: $(curl -fsS --max-time 10 "$SHELL_ORIGIN/version.json" || echo 'could not read /version.json')"
echo
echo "The Settings build row reports the DEPLOYMENT's build, printed above as"
echo "'serving' — the shell carries no web code of its own to report. If that"
echo "row shows something else, the app is not loading from this origin."
echo
echo "A TESTER CAN CHECK THIS WITHOUT YOU: the quiet line under the build card"
echo "in Settings is the host the app is actually running on, so it reads"
echo "'${SHELL_ORIGIN#https://}' on this APK. If it says something else, that"
echo "is the truth and this banner is not."
