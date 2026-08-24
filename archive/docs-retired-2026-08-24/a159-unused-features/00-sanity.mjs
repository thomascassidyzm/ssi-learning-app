// Sanity gate: courses must count ~145. Materially lower = anon key leaked in.
import { count } from './_db.mjs'
const c = await count('courses')
console.log('courses count =', c)
if (!(c >= 130)) { console.error('ABORT: courses count too low — key may be anon-scoped.'); process.exit(1) }
console.log('OK — service-role visibility confirmed.')
