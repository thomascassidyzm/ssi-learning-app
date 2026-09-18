/**
 * @vitest-environment node
 *
 * Source pins for Tom's 2026-09-18 ruling (job #188): return sign-in at
 * /schools LEADS with the password and offers the code as the fallback; the
 * password prompt is the default first step on entry, mounted once in the
 * shell; and Resend on the code step is cooled down with the consequence
 * named. SchoolsContainer is too heavy to mount in a unit test, so these read
 * the source the way the sibling createClassDirect pin does. Seen red on the
 * pre-fix container (usePassword false, no prompt in the shell, bare Resend)
 * and green after.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const container = readFileSync(join(here, 'SchoolsContainer.vue'), 'utf8')
const dashboard = readFileSync(join(here, '..', 'views', 'schools', 'DashboardView.vue'), 'utf8')

describe('SchoolsContainer — password first, code as the fallback', () => {
  it('leads with the password on the sign-in screen', () => {
    expect(container).toMatch(/const usePassword = ref\(true\)/)
    expect(container).toContain('No password yet? Email me a code instead')
  })
  it('mounts the password prompt once in the shell, opening itself on first entry', () => {
    expect(container).toContain('<SchoolsPasswordPrompt auto-open />')
    expect(dashboard).not.toContain('<SchoolsPasswordPrompt')
  })
  it('cools Resend down and names supersession on the code step', () => {
    expect(container).toContain('resendCooldown.canResend.value')
    expect(container).toContain('SUPERSESSION_NOTICE')
    expect(container).toContain('friendlyVerifyCodeError(')
    expect(container).not.toContain('It expires in about an hour')
  })
})
