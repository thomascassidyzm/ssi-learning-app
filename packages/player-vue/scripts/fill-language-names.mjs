/**
 * Fill the gaps in each locale's `languages` block from CLDR.
 *
 * getLanguageName now reads our own JSON first, because Intl.DisplayNames
 * answers in English on a device whose ICU lacks data for the interface
 * language — silently, which is how a Welsh tester got "i siaradwyr English".
 * That makes JSON coverage the thing that decides whether a name localises,
 * so every locale needs an entry for every language we name.
 *
 * Only ADDS missing keys; never touches a curated one. Run with a full-ICU
 * node (node --version >= 14 on a full-icu build):
 *
 *   node scripts/fill-language-names.mjs          # report only
 *   node scripts/fill-language-names.mjs --write  # apply
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const LOCALES = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'locales')
const WRITE = process.argv.includes('--write')

// ISO 639-3 → BCP 47, mirroring useI18n.ts. Codes not listed are passed through.
const ISO3_TO_BCP47 = {
  eng: 'en', spa: 'es', fra: 'fr', deu: 'de', ita: 'it', por: 'pt',
  nld: 'nl', pol: 'pl', rus: 'ru', cym: 'cy', gle: 'ga', gla: 'gd',
  jpn: 'ja', zho: 'zh', cmn: 'zh', kor: 'ko', ara: 'ar', hin: 'hi',
  tur: 'tr', swa: 'sw', ron: 'ro', cat: 'ca', eus: 'eu', glg: 'gl',
  swe: 'sv', nor: 'no', nob: 'nb', nno: 'nn', dan: 'da', fin: 'fi',
  isl: 'is', hrv: 'hr', srp: 'sr', bos: 'bs', slv: 'sl', ces: 'cs',
  slk: 'sk', ukr: 'uk', bul: 'bg', mkd: 'mk', ell: 'el', hun: 'hu',
  heb: 'he', sqi: 'sq', lit: 'lt', lav: 'lv', est: 'et', tha: 'th',
  vie: 'vi', ind: 'id', fil: 'tl', ben: 'bn', urd: 'ur', tam: 'ta',
  tel: 'te', msa: 'ms', yue: 'yue', fas: 'fa', kur: 'ku', amh: 'am',
  hau: 'ha', yor: 'yo', zul: 'zu', kat: 'ka', hye: 'hy', bre: 'br',
  cor: 'kw', sin: 'si', guj: 'gu', pan: 'pa', aze: 'az', nep: 'ne',
  afr: 'af', glv: 'gv',
}
const LOCALE_OF = { ...ISO3_TO_BCP47, cym_n: 'cy', cym_s: 'cy' }

// The full key set we want everywhere: whatever English already names, plus
// the interface languages themselves (they appear as course known-languages).
const eng = JSON.parse(readFileSync(join(LOCALES, 'eng.json'), 'utf8'))
const files = readdirSync(LOCALES).filter((f) => f.endsWith('.json'))
const wanted = new Set([
  ...Object.keys(eng.languages).filter((k) => !k.endsWith('_suffix')),
  ...files.map((f) => f.replace('.json', '')),
])

for (const file of files.sort()) {
  const iso3 = file.replace('.json', '')
  const readingLocale = LOCALE_OF[iso3]
  if (!readingLocale) { console.log(`${file}: no BCP47 for the locale itself — skipped`); continue }

  const raw = readFileSync(join(LOCALES, file), 'utf8')
  const data = JSON.parse(raw)
  if (!data.languages) { console.log(`${file}: no languages block — skipped`); continue }

  const display = new Intl.DisplayNames([readingLocale], { type: 'language' })
  const added = {}
  for (const code of [...wanted].sort()) {
    if (data.languages[code]) continue
    const bcp47 = ISO3_TO_BCP47[code] || code
    let name
    try { name = display.of(bcp47) } catch { name = null }
    // No data for this pair — leave the key out and let the runtime fall
    // through to Intl on the user's own device.
    if (!name || name === bcp47) continue
    name = name.charAt(0).toUpperCase() + name.slice(1)
    // Dialect codes carry their variant in the name, as the curated rows do.
    if (code === 'cym_n') name = `${name} (${data.languages.cym_n_suffix || 'North'})`
    if (code === 'cym_s') name = `${name} (${data.languages.cym_s_suffix || 'South'})`
    if (code === 'nob') name = `${name} (Bokmål)`
    if (code === 'nno') name = `${name} (Nynorsk)`
    added[code] = name
  }

  const count = Object.keys(added).length
  console.log(`${file}: +${count}${count ? ' — ' + Object.keys(added).join(', ') : ''}`)
  if (!count || !WRITE) continue

  data.languages = Object.fromEntries(
    Object.entries({ ...data.languages, ...added }).sort(([a], [b]) => a.localeCompare(b))
  )
  const indent = raw.includes('\n    "') ? 2 : 2
  writeFileSync(join(LOCALES, file), JSON.stringify(data, null, indent) + '\n')
}
