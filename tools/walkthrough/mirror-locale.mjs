#!/usr/bin/env node
/**
 * The walk mirror in eng.json, regenerated from pack.json (job #386).
 *
 * localiseWalk reads every walk's learner-facing strings through t() under
 * `walkthrough.<id>.*`, and localiseWalk.test.ts fails unless that mirror IS
 * the pack, string for string, for every walk. Until now the mirror was kept
 * by hand, which was fine at eighteen walks and is not at eighty-eight. So:
 *
 *   node tools/walkthrough/mirror-locale.mjs
 *
 * rewrites `walkthrough` in eng.json from the compiled pack, and enrols in
 * i18n/pending-translation.json every walk key that at least one other
 * locale is still missing — the honest register of translation debt the
 * parity gate asks for — while retiring any walk key the pack no longer has.
 * eng.json's other blocks are untouched; the other locale files are never
 * written here (tools/i18n/fill.mjs is how they get filled).
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const LOCALES = join(ROOT, 'packages/player-vue/src/locales')
const PACK = JSON.parse(readFileSync(join(ROOT, 'packages/player-vue/src/walkthrough/pack.json'), 'utf8'))
const ENG_PATH = join(LOCALES, 'eng.json')
const PENDING_PATH = join(ROOT, 'packages/player-vue/src/i18n/pending-translation.json')

const eng = JSON.parse(readFileSync(ENG_PATH, 'utf8'))
const mirror = {}
const keys = []
for (const w of PACK.walks) {
  const m = { title: w.title }
  keys.push(`walkthrough.${w.id}.title`)
  if (w.topic) { m.topic = w.topic; keys.push(`walkthrough.${w.id}.topic`) }
  m.steps = {}
  w.steps.forEach((s, i) => {
    m.steps[String(i)] = { say: s.say }
    keys.push(`walkthrough.${w.id}.steps.${i}.say`)
    if (s.terminal) { m.steps[String(i)].terminal = s.terminal; keys.push(`walkthrough.${w.id}.steps.${i}.terminal`) }
  })
  mirror[w.id] = m
}
eng.walkthrough = mirror
writeFileSync(ENG_PATH, JSON.stringify(eng, null, 2) + '\n')

// Which of those keys is some other locale still missing?
const get = (obj, path) => path.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj)
const others = readdirSync(LOCALES).filter((f) => f.endsWith('.json') && f !== 'eng.json')
  .map((f) => JSON.parse(readFileSync(join(LOCALES, f), 'utf8')))
const missingSomewhere = keys.filter((k) => others.some((loc) => typeof get(loc, k) !== 'string'))

const pending = JSON.parse(readFileSync(PENDING_PATH, 'utf8'))
const listKey = Object.keys(pending).find((k) => Array.isArray(pending[k]))
const kept = pending[listKey].filter((k) => !k.startsWith('walkthrough.'))
pending[listKey] = [...kept, ...missingSomewhere]
writeFileSync(PENDING_PATH, JSON.stringify(pending, null, 2) + '\n')
console.log(`[walkthrough] mirror: ${PACK.walks.length} walks · ${keys.length} strings into eng.json · ${missingSomewhere.length} awaiting translation in pending-translation.json`)
