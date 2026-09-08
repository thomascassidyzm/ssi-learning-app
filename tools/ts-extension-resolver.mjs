/**
 * Node resolve hook: let a plain .mjs tool import the app's own TypeScript
 * modules by their extensionless specifiers, the way tsc and vitest read them.
 *
 * Why this exists rather than a copy of the rules: a backfill that re-implements
 * "which domains may a school claim" is a second answer that can drift from the
 * live one. Importing api/_utils/schoolDomain.ts means the script refuses exactly
 * what the running code refuses. Node strips the types (--experimental-strip-types);
 * it just will not guess the extension, which is all this adds.
 *
 *   node --experimental-strip-types --import ./tools/ts-extension-resolver.mjs tool.mjs
 */
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'
import { existsSync } from 'node:fs'

const hook = `
export async function resolve(specifier, context, next) {
  if (specifier.startsWith('.') && !/\\.[cm]?[jt]sx?$/.test(specifier)) {
    const base = new URL(specifier, context.parentURL)
    for (const ext of ['.ts', '.mjs', '.js', '/index.ts']) {
      try { return await next(specifier + ext, context) } catch { /* try the next */ }
    }
  }
  return next(specifier, context)
}
`
register(`data:text/javascript,${encodeURIComponent(hook)}`, pathToFileURL('./'))
if (!existsSync('package.json')) { /* run from anywhere; nothing else to do */ }
