/**
 * ts-resolve-hook.mjs — lets `node scripts/*.mts` import the api/_utils/*.ts
 * modules directly, so a one-off script can exercise the REAL server-side
 * utilities instead of re-implementing their queries.
 *
 * Node 22+ strips TypeScript types natively, but the api/ sources use bundler-
 * style extensionless imports ('./schoolScope'), which the ESM resolver rejects.
 * This hook retries a failed relative specifier with '.ts' appended — exactly
 * what tsc/vite do at build time. Dev tooling only; nothing ships with it.
 *
 * Usage: node --import ./scripts/ts-resolve-hook.mjs scripts/whatever.mts
 */

import { register } from 'node:module'
import { pathToFileURL } from 'node:url'

if (!process.env.__SSI_TS_RESOLVE_REGISTERED) {
  process.env.__SSI_TS_RESOLVE_REGISTERED = '1'
  register(pathToFileURL(new URL('./ts-resolve-hook-impl.mjs', import.meta.url).pathname))
}
