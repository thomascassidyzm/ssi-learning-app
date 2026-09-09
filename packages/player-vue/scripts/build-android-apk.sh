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
#
# The optional argument overrides the origin for one build. The DEFAULT, and
# the one-line production switch, lives in capacitor.config.ts.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"

if [ "${1:-}" != "" ]; then
  export SSI_SHELL_ORIGIN="$1"
fi
SHELL_ORIGIN="${SSI_SHELL_ORIGIN:-https://saysomethingin.app}"
SHELL_ORIGIN="${SHELL_ORIGIN%/}"

echo "==> shell origin: $SHELL_ORIGIN"

echo "==> writing the holding notice into shell-web/"
scripts/write-shell-web.sh "$SHELL_ORIGIN"

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
echo "    origin : $SHELL_ORIGIN"
echo "    serving: $(curl -fsS --max-time 10 "$SHELL_ORIGIN/version.json" || echo 'could not read /version.json')"
echo
echo "The Settings build row reports the DEPLOYMENT's build, printed above as"
echo "'serving' — the shell carries no web code of its own to report. If that"
echo "row shows something else, the app is not loading from this origin."
