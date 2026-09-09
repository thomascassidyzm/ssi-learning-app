#!/usr/bin/env bash
# Writes the shell's holding notice into shell-web/, which is capacitor.config.ts's
# `webDir`. It is NOT the app: with `server.url` set the WebView never reads these
# assets. `cap sync` insists the directory exists, and this page is what a reader
# finds there instead of 823 frozen files of web app that nothing loads.
#
# BOTH PLATFORMS COPY IT. build-android-apk.sh calls this, and `npx cap sync ios`
# copies the same directory — which is why the directory is no longer called
# android-shell-web.
#
# Usage: scripts/write-shell-web.sh [origin]   (default: $SSI_SHELL_ORIGIN, else production)
set -euo pipefail
cd "$(dirname "$0")/.."

SHELL_ORIGIN="${1:-${SSI_SHELL_ORIGIN:-https://saysomethingin.app}}"
SHELL_ORIGIN="${SHELL_ORIGIN%/}"

mkdir -p shell-web
cat > shell-web/index.html <<HTML
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

echo "==> wrote shell-web/index.html pointing at $SHELL_ORIGIN"
