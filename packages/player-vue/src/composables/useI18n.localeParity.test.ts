/**
 * Every interface language must carry every UI string English carries.
 *
 * eng.json is both the source of truth and the runtime fallback, so a key
 * added to English and to nothing else does not break anything loudly — it
 * just renders in English inside an otherwise Welsh or Yoruba screen, and
 * nobody notices until a tester does. This is the guard that makes that a
 * red CI run on the PR that caused it, rather than a discovery months later:
 * as of 2026-08-26 all 21 non-English locales were short the same ~50 UI
 * keys, which is exactly the drift a PR-time check would never have allowed
 * to accumulate.
 *
 * The failure message names the exact missing keys per language, not a
 * count — a count tells you something broke, the keys tell you what to do.
 *
 * The `languages.*` block is deliberately exempt from the parity assertion
 * (see LANGUAGES_PREFIX below). Everything else is strict.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const LOCALES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'locales')
const SOURCE = 'eng.json'

/**
 * A locale may carry fewer language NAMES than English without being broken:
 * getLanguageName() falls through to Intl.DisplayNames for anything the JSON
 * doesn't curate, and that fall-through is designed behaviour with its own
 * test (useI18n.languageNames.test.ts). Curating all 92 names in all 22
 * languages would be ~1,900 translations to replace a working fallback.
 *
 * What is NOT exempt here: orphans and empty strings in that block, both
 * asserted below — and note the curated name still wins where it exists,
 * which is the whole point of that other test. If we ever decide the Intl
 * fall-through isn't good enough (it answers in English on a device whose
 * ICU lacks data for the interface language), delete this constant and the
 * one `filter` that uses it, and the block becomes strict like the rest.
 */
const LANGUAGES_PREFIX = 'languages.'

type Leaf = [key: string, value: unknown]

/** Nested locale JSON → dot-path leaves, e.g. `settings.terms`. */
function flatten(obj: Record<string, unknown>, prefix = ''): Leaf[] {
  return Object.entries(obj).flatMap(([k, v]): Leaf[] =>
    v !== null && typeof v === 'object' && !Array.isArray(v)
      ? flatten(v as Record<string, unknown>, `${prefix}${k}.`)
      : [[`${prefix}${k}`, v]],
  )
}

function loadLocale(file: string): Map<string, unknown> {
  return new Map(flatten(JSON.parse(readFileSync(join(LOCALES_DIR, file), 'utf8'))))
}

const localeFiles = readdirSync(LOCALES_DIR)
  .filter((f) => f.endsWith('.json'))
  .sort()

const otherLocales = localeFiles.filter((f) => f !== SOURCE)
const english = loadLocale(SOURCE)
const englishKeys = [...english.keys()]
const englishUiKeys = englishKeys.filter((k) => !k.startsWith(LANGUAGES_PREFIX))

/** Keys listed one per line — a copy-pasteable to-do list, not a number. */
const report = (heading: string, keys: string[]) =>
  `${heading}\n  ${keys.join('\n  ')}`

describe('locale parity with eng.json', () => {
  it('has locale files to check, and English is one of them', () => {
    expect(localeFiles).toContain(SOURCE)
    expect(otherLocales.length).toBeGreaterThan(0)
    expect(englishUiKeys.length).toBeGreaterThan(0)
  })

  it.each(otherLocales)('%s carries every UI string English carries', (file) => {
    const locale = loadLocale(file)
    const missing = englishUiKeys.filter((k) => !locale.has(k))

    expect(
      missing,
      report(
        `${file} is missing ${missing.length} UI key(s) that eng.json has. ` +
          `These render in English inside a non-English interface. Add them to ${file}:`,
        missing,
      ),
    ).toEqual([])
  })

  it.each(otherLocales)('%s has no keys English has dropped', (file) => {
    const locale = loadLocale(file)
    const orphans = [...locale.keys()].filter((k) => !english.has(k))

    expect(
      orphans,
      report(
        `${file} has ${orphans.length} key(s) that eng.json does not. ` +
          `These are dead weight — usually a rename that only landed in English. ` +
          `Either restore them to eng.json or delete them from ${file}:`,
        orphans,
      ),
    ).toEqual([])
  })

  it.each(otherLocales)('%s has no blank translations', (file) => {
    // A key present but empty is worse than a key absent: t() can fall back
    // for an absent key, and an empty string is a legitimate-looking value.
    const blanks = [...loadLocale(file)]
      .filter(([, v]) => typeof v === 'string' && v.trim() === '')
      .map(([k]) => k)

    expect(
      blanks,
      report(
        `${file} has ${blanks.length} key(s) whose translation is an empty string. ` +
          `Delete the key (English then shows) or translate it:`,
        blanks,
      ),
    ).toEqual([])
  })

  it.each(otherLocales)('%s matches the shape of eng.json where keys are shared', (file) => {
    // A string in English that is an object in another locale (or vice versa)
    // means t() walks off the path and silently returns the key itself.
    const locale = loadLocale(file)
    const mismatched = [...locale.entries()]
      .filter(([k, v]) => english.has(k) && typeof v !== typeof english.get(k))
      .map(([k, v]) => `${k}: ${file} has ${typeof v}, eng.json has ${typeof english.get(k)}`)

    expect(
      mismatched,
      report(`${file} disagrees with eng.json about the type of these keys:`, mismatched),
    ).toEqual([])
  })
})
