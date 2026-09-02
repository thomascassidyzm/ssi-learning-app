/**
 * Boot persistence: a saved interface language must be APPLIED on boot,
 * not merely remembered.
 *
 * Field report (Jonathan Stainton-E., tester, 2026-08-25): his setting read
 * Cymraeg, the whole interface read English; re-picking Cymraeg fixed it for
 * that session, and the next launch was English again. The preference was
 * persisting fine — the boot-time apply was throwing and being swallowed.
 *
 * These tests import the module FRESH with a locale already in localStorage,
 * which is the only way to exercise the module-evaluation boot path.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const flush = () => new Promise((r) => setTimeout(r, 0))

// The locale chunk is a dynamic import, so "applied on boot" is only ever
// observable a tick or two later — and the very first import of a locale in a
// run also pays for its transform. Poll rather than guess a tick count.
const waitFor = async (probe: () => boolean, timeoutMs = 3000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (probe()) return true
    await flush()
  }
  return probe()
}

describe('useI18n boot persistence', () => {
  beforeEach(() => {
    vi.resetModules()
    localStorage.clear()
    document.documentElement.lang = 'en'
  })

  it('applies a saved non-English locale to the messages on boot', async () => {
    localStorage.setItem('ssi-locale', 'cym')

    const { t, useI18n } = await import('./useI18n')
    await waitFor(() => t('resting.readyWhenYouAre') !== 'Ready when you are')

    expect(useI18n().locale.value).toBe('cym')
    expect(t('resting.readyWhenYouAre')).toBe('Yn barod pan wyt ti')
  })

  it('publishes the saved locale on <html lang> on boot', async () => {
    localStorage.setItem('ssi-locale', 'cym')

    await import('./useI18n')
    await flush()

    expect(document.documentElement.lang).toBe('cy')
  })


  // Boot re-saves the stored locale to kick off its chunk fetch. That re-save
  // must carry the stored SOURCE, or an inferred guess is promoted to a choice
  // on the next page load and the interface language is locked against every
  // later deep link. Found in the browser on staging, 2026-09-02.
  it('does not promote an inferred locale to a chosen one on boot', async () => {
    localStorage.setItem('ssi-locale', 'hin')
    localStorage.setItem('ssi-locale-source', 'inferred')

    const { hasChosenLocale } = await import('./useI18n')
    await waitFor(() => localStorage.getItem('ssi-locale-source') !== null)

    expect(localStorage.getItem('ssi-locale-source')).toBe('inferred')
    expect(hasChosenLocale()).toBe(false)
  })

  it('keeps a chosen locale chosen across a boot', async () => {
    localStorage.setItem('ssi-locale', 'cym')
    localStorage.setItem('ssi-locale-source', 'chosen')

    const { hasChosenLocale } = await import('./useI18n')
    await flush()

    expect(localStorage.getItem('ssi-locale-source')).toBe('chosen')
    expect(hasChosenLocale()).toBe(true)
  })

  // A locale stored before the source key existed can only have come from the
  // Settings picker, so boot must not downgrade it to a guess either.
  it('treats a sourceless legacy locale as chosen through boot', async () => {
    localStorage.setItem('ssi-locale', 'cym')

    const { hasChosenLocale } = await import('./useI18n')
    await flush()

    expect(hasChosenLocale()).toBe(true)
  })

  it('survives a relaunch: what setLocale stored is what the next boot renders', async () => {
    // Session 1 — the learner picks Cymraeg.
    const first = await import('./useI18n')
    await first.setLocale('cym')
    expect(first.t('resting.readyWhenYouAre')).toBe('Yn barod pan wyt ti')

    // Session 2 — app closed and reopened: same storage, fresh module.
    vi.resetModules()
    const second = await import('./useI18n')
    await waitFor(() => second.t('resting.readyWhenYouAre') !== 'Ready when you are')

    expect(localStorage.getItem('ssi-locale')).toBe('cym')
    expect(second.t('resting.readyWhenYouAre')).toBe('Yn barod pan wyt ti')
  })

  it('stays on English when nothing is stored', async () => {
    const { t } = await import('./useI18n')
    await flush()

    expect(t('resting.readyWhenYouAre')).toBe('Ready when you are')
  })
})
