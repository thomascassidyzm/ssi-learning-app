#!/usr/bin/env node
/**
 * The OTHER way the shell gets named: a .env file, not an exported variable.
 *
 * `_payment-route-bundle-check.mjs` passes VITE_APP_SHELL through process.env,
 * which is the one path that always worked — so it could never see this. Vite
 * loads .env files AFTER evaluating vite.config.js, so a config reading
 * `process.env.VITE_APP_SHELL` sees nothing while the app, reading
 * `import.meta.env`, sees 'webview'. The build constant said web, the running
 * app said native, and seat purchase stayed in the artifact.
 *
 * Reproduced on 2026-09-05 (found by an outside review of #509/#511): this
 * script FAILED against the old config and passes against loadEnv().
 *
 *   node e2e/_payment-route-envfile-check.mjs
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const ROOT = process.cwd()
const ENVFILE = join(ROOT, '.env.production')
const MARKERS = ['schools-upgrade', 'org-upgrade', 'teach-upgrade', 'per teacher seat']
if (existsSync(ENVFILE)) { console.error('refusing: .env.production already exists'); process.exit(2) }
writeFileSync(ENVFILE, 'VITE_APP_SHELL=webview\n')
const out = mkdtempSync(join(tmpdir(), 'ssi-envfile-'))
try {
  execFileSync('npx', ['vite', 'build', '--outDir', out], { stdio: 'inherit', env: { ...process.env } })
  const src = readdirSync(join(out, 'assets')).filter(f => f.endsWith('.js'))
    .map(f => readFileSync(join(out, 'assets', f), 'utf8'))
  const leaked = MARKERS.filter(m => src.some(s => s.includes(m)))
  if (leaked.length) { console.error('FAIL — seat purchase still in the artifact: ' + leaked.join(', ')); process.exit(1) }
  console.log('PASS — .env.production VITE_APP_SHELL=webview removed seat purchase from the build')
} finally {
  rmSync(ENVFILE, { force: true })
  rmSync(out, { recursive: true, force: true })
}
