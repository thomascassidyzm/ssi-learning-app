/**
 * Detect locale keys whose value is byte-identical to the English value.
 *
 * Key-parity gates only check that a key EXISTS in every locale file — they
 * are structurally blind to a key that exists but still holds the raw
 * English string. That's a real, silent defect (a learner reads English),
 * but the fix differs by script:
 *
 *   - Non-Latin-script locale (hin/urd/pan/guj/ben/tam/sin/jpn/zho/kor/ara/...):
 *     an English-identical value is unambiguous. FAIL (non-zero exit).
 *   - Latin-script locale (deu/fra/ita/spa/cym/aze/gle/...):
 *     a legitimate cognate (German "Pause", French "Forum") and a genuine
 *     oversight look identical to this check — a human has to call it.
 *     WARN (reported, exit stays zero) unless the exact locale+key pair is
 *     on REVIEWED_COGNATES below, in which case it's silent.
 *
 * `brand.*`, `app.name`, and the whole `languages.*` section are excluded
 * in every locale — the wordmark stays Latin deliberately, and a language
 * name legitimately not changing between languages is not a defect.
 *
 * Usage:
 *   node packages/player-vue/scripts/i18n-english-passthrough-check.mjs
 *   node packages/player-vue/scripts/i18n-english-passthrough-check.mjs /path/to/locales/dir
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_LOCALES = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'locales')
const LOCALES_DIR = process.argv[2] || DEFAULT_LOCALES

// Reviewed cognates: a human looked at this exact locale+key pair and
// judged the English-identical value a legitimate cognate, not an
// oversight. Being a cognate in one locale says nothing about another —
// hence pairs, not bare keys. To add one: confirm a native/fluent read,
// then append it here with the same {locale, key} shape.
const REVIEWED_COGNATES = [
  { locale: 'deu', key: 'player.pause' },
  { locale: 'deu', key: 'home.seeds' },
  { locale: 'deu', key: 'settings.dashboards' },
  { locale: 'deu', key: 'settings.codes' },
  { locale: 'deu', key: 'settings.community' },
  { locale: 'deu', key: 'settings.forum' },
  { locale: 'deu', key: 'settings.version' },
  { locale: 'deu', key: 'belt.orange' },
  { locale: 'deu', key: 'download.pause' },
  { locale: 'deu', key: 'browser.seeds' },
  { locale: 'fra', key: 'modes.modes' },
  { locale: 'fra', key: 'player.pause' },
  { locale: 'fra', key: 'home.phrases' },
  { locale: 'fra', key: 'settings.codes' },
  { locale: 'fra', key: 'settings.forum' },
  { locale: 'fra', key: 'settings.version' },
  { locale: 'fra', key: 'belt.orange' },
  { locale: 'fra', key: 'download.pause' },
  { locale: 'fra', key: 'contribution.minutes' },
  { locale: 'ita', key: 'settings.community' },
  { locale: 'ita', key: 'settings.forum' },
  { locale: 'ita', key: 'settings.account' },
  { locale: 'ita', key: 'driving.round' },
  { locale: 'spa', key: 'home.seeds' },
  { locale: 'spa', key: 'settings.legal' },
  { locale: 'spa', key: 'browser.seeds' },
  { locale: 'cym', key: 'settings.data' },
  { locale: 'cym', key: 'belt.brown' },
  { locale: 'aze', key: 'settings.forum' },
]
const isReviewedCognate = (locale, key) =>
  REVIEWED_COGNATES.some((c) => c.locale === locale && c.key === key)

// Cross-check set — the eleven Tom named. Used only to sanity-check the
// derived classifier below, never as the classification itself, so a 22nd
// non-Latin locale is caught automatically rather than needing a code change.
const KNOWN_NON_LATIN = new Set([
  'hin', 'urd', 'pan', 'guj', 'ben', 'tam', 'sin', 'jpn', 'zho', 'kor', 'ara',
])

const EXCLUDED_PREFIXES = ['brand.', 'app.name', 'languages.']
const isExcluded = (key) => EXCLUDED_PREFIXES.some((p) => key === p.replace(/\.$/, '') || key.startsWith(p))

function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      flatten(v, key, out)
    } else {
      out[key] = v
    }
  }
  return out
}

// Latin script + combining marks + common Latin-Extended ranges, covering
// every locale in this repo's Latin set (deu/fra/ita/spa/cym/aze/gle/por/lit/yor).
const LATIN_CHAR_RE = /[A-Za-zÀ-ʯḀ-ỿ]/
// Anything "letter-like" outside the ASCII punctuation/digit/space set.
const LETTER_RE = /\p{L}/u

function classifyScript(values) {
  let latinLetters = 0
  let totalLetters = 0
  for (const v of values) {
    if (typeof v !== 'string') continue
    for (const ch of v) {
      if (!LETTER_RE.test(ch)) continue
      totalLetters++
      if (LATIN_CHAR_RE.test(ch)) latinLetters++
    }
  }
  if (totalLetters === 0) return 'unknown'
  return latinLetters / totalLetters > 0.5 ? 'latin' : 'non-latin'
}

function main() {
  const engPath = join(LOCALES_DIR, 'eng.json')
  const eng = flatten(JSON.parse(readFileSync(engPath, 'utf8')))

  const localeFiles = readdirSync(LOCALES_DIR)
    .filter((f) => f.endsWith('.json') && f !== 'eng.json')
    .sort()

  const failures = []
  const warnings = []
  const classifierDisagreements = []

  for (const file of localeFiles) {
    const locale = file.replace(/\.json$/, '')
    const flat = flatten(JSON.parse(readFileSync(join(LOCALES_DIR, file), 'utf8')))
    const values = Object.entries(flat)
      .filter(([k]) => !isExcluded(k))
      .map(([, v]) => v)
    const scriptClass = classifyScript(values)

    const knownNonLatin = KNOWN_NON_LATIN.has(locale)
    const derivedNonLatin = scriptClass === 'non-latin'
    if (knownNonLatin !== derivedNonLatin) {
      classifierDisagreements.push({ locale, derivedNonLatin, knownNonLatin })
    }

    for (const [key, value] of Object.entries(flat)) {
      if (isExcluded(key)) continue
      if (!(key in eng)) continue
      if (eng[key] !== value) continue
      if (typeof value !== 'string' || value.trim() === '') continue

      if (derivedNonLatin) {
        failures.push({ locale, key, value })
      } else if (!isReviewedCognate(locale, key)) {
        warnings.push({ locale, key, value })
      }
    }
  }

  if (classifierDisagreements.length) {
    console.log('Script-classifier cross-check disagreements (derived vs Tom\'s named list):')
    for (const d of classifierDisagreements) {
      console.log(`  ${d.locale}: derived non-latin=${d.derivedNonLatin}, named non-latin=${d.knownNonLatin}`)
    }
    console.log('')
  }

  if (warnings.length) {
    console.log(`WARN: ${warnings.length} English-identical value(s) in Latin-script locales (unreviewed — may be legitimate cognates):`)
    for (const w of warnings) {
      console.log(`  [WARN] ${w.locale}.${w.key} = "${w.value}"`)
    }
    console.log('')
  }

  if (failures.length) {
    console.log(`FAIL: ${failures.length} English-identical value(s) found in non-Latin-script locale(s).`)
    console.log('A non-Latin-script UI cannot legitimately contain an untranslated English string:\n')
    for (const f of failures) {
      console.log(`  [FAIL] ${f.locale}.${f.key} = "${f.value}"`)
    }
    console.log('\nFix: translate the value(s) above, or add a reviewed-cognate entry if genuinely intentional (non-Latin locales rarely qualify).')
    process.exit(1)
  }

  console.log(`OK: no English-passthrough values found in any non-Latin-script locale (${warnings.length} Latin-script warning(s), non-fatal).`)
}

main()
