/**
 * Variant course code → flag country, resolved automatically.
 *
 * A course code is `<target>_for_<known>`, and the target side may carry a
 * variant suffix: `deu_at_for_eng` (Austrian German), `por_br_for_eng`
 * (Brazilian Portuguese). Nearly every real variant suffix already IS the
 * ISO-3166-1 alpha-2 code of the country it belongs to, so we resolve it by
 * rule rather than by a hand-maintained map — a brand-new variant course gets
 * its own flag the moment it exists in `courses`, with no code change.
 *
 * The flag SVGs are the vendored circle-flags country set in
 * `assets/flags/countries/`. Anything this module returns null for keeps its
 * PARENT language's flag, which is always safe.
 */

/**
 * Languages whose sub-variants are DIALECTS INSIDE ONE COUNTRY, never separate
 * nations. Their variants deliberately keep the parent flag and carry a
 * `variant_label` ("Northern", "Munster (Kerry)") instead.
 *
 * This also stops two live suffix collisions dead: Irish `gle_cn` is Connemara,
 * not China; `gle_mu` is Munster, not Mauritius.
 */
const DIALECT_ONLY_LANGUAGES = new Set(['cym', 'gle'])

/**
 * The only cases where the suffix is NOT the country code we want to fly.
 * Keep this table as close to empty as reality allows.
 */
const VARIANT_FLAG_ALIASES: Record<string, string> = {
  // Quebec French flies the Québec fleurdelisé, not the maple leaf.
  fra_ca: 'ca-qc',
}

/**
 * The whole target side of a course code, variant suffix included.
 * 'deu_at_for_eng' → 'deu_at' · 'deu_for_eng' → 'deu' · 'deu' → 'deu'
 */
export function extractVariantKey(code: string): string {
  if (!code) return ''
  const forIndex = code.indexOf('_for_')
  return forIndex === -1 ? code : code.substring(0, forIndex)
}

/**
 * The base language of a course code, variant suffix dropped.
 * 'cym_s_for_eng' → 'cym' · 'eng_for_spa' → 'eng'
 */
export function extractBaseLanguage(code: string): string {
  return extractVariantKey(code).split('_')[0]
}

/**
 * The flag key for a variant course code, or null if it has no variant flag of
 * its own (bare language, dialect-only language, or a suffix that isn't a
 * country code — a template or test course, say).
 *
 * Returns an `assets/flags/countries/` filename stem: usually a 2-letter ISO
 * country code, occasionally a subdivision like 'ca-qc'.
 */
export function variantFlagKey(code: string): string | null {
  const key = extractVariantKey(code)
  if (!key.includes('_')) return null

  const alias = VARIANT_FLAG_ALIASES[key]
  if (alias) return alias

  const base = key.split('_')[0]
  if (DIALECT_ONLY_LANGUAGES.has(base)) return null

  // Everything after the base language. A real country code is exactly two
  // letters; 'nnew', 'anthem', 'template' and 'test2' are not, and fall through.
  const suffix = key.substring(base.length + 1)
  return /^[a-z]{2}$/.test(suffix) ? suffix : null
}

/**
 * The ISO-3166-1 alpha-2 country code for a variant, or null. Same rule as
 * `variantFlagKey`, but subdivision keys ('ca-qc') are excluded because they
 * have no regional-indicator emoji. Used by the emoji fallback path.
 */
export function variantCountryCode(code: string): string | null {
  const key = variantFlagKey(code)
  return key && /^[a-z]{2}$/.test(key) ? key : null
}
