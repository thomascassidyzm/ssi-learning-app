/**
 * Region-tier E2E journey — real headless Chrome against a live deployment
 * (run with PROD_URL, e.g. `PROD_URL=https://staging.saysomethingin.app`),
 * driving the full leader → school flow with synthetic @ssi-internal.test
 * accounts (see helpers.ts for the OTP-without-email mechanism).
 *
 * Runs as ONE test with try/catch per step (not test.describe.serial) so an
 * early failure doesn't skip later, independent checks — each step records
 * a pass/fail/skip into `results`, which is written to a JSON+Markdown
 * report and printed at the end regardless of what failed.
 *
 * Every write this test performs is tracked on `ledger` and reversed in
 * afterAll, whether the run passed or not.
 */
import { test, expect, type Page } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import {
  admin,
  newLedger,
  syntheticEmail,
  createSyntheticUser,
  markLearnerInternal,
  signInViaOtp,
  getAccessTokenFromPage,
  cleanup,
  pickAnyLiveCourseCode,
  type CleanupLedger,
} from './helpers'

test.skip(!process.env.PROD_URL, 'Run against a real deployment: PROD_URL=https://staging.saysomethingin.app pnpm e2e:region-tier')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const RUN_ID = `${Date.now()}`
const REPORT_DIR = path.join(__dirname, 'reports', RUN_ID)
const SCREENSHOT_DIR = path.join(REPORT_DIR, 'screenshots')

interface StepResult {
  step: string
  name: string
  status: 'pass' | 'fail' | 'skip'
  detail?: string
  screenshot?: string
}
const results: StepResult[] = []
const ledger: CleanupLedger = newLedger()

async function shoot(page: Page, name: string): Promise<string> {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })
  const file = path.join(SCREENSHOT_DIR, `${name}.png`)
  await page.screenshot({ path: file, fullPage: true }).catch(() => {})
  return file
}

async function step(
  stepId: string,
  name: string,
  fn: () => Promise<void>,
  screenshotFrom?: Page
): Promise<void> {
  try {
    await fn()
    let screenshot: string | undefined
    if (screenshotFrom) screenshot = await shoot(screenshotFrom, `${stepId}-pass`)
    results.push({ step: stepId, name, status: 'pass', screenshot })
    console.log(`[PASS] ${stepId} ${name}`)
  } catch (err: any) {
    let screenshot: string | undefined
    if (screenshotFrom) screenshot = await shoot(screenshotFrom, `${stepId}-fail`).catch(() => undefined)
    const detail = err?.message || String(err)
    results.push({ step: stepId, name, status: 'fail', detail, screenshot })
    console.error(`[FAIL] ${stepId} ${name}: ${detail}`)
  }
}

// Playwright's default actionTimeout is 0 (unbounded) — a stuck fill/click
// would otherwise hang until the whole-test timeout. test.use() only bounds
// the auto-injected `page`/`context` fixtures, NOT contexts created manually
// via browser.newContext() (which this spec needs, one per persona) — so
// every manually-created page gets its defaults set explicitly here.
function boundTimeouts(page: Page): Page {
  page.setDefaultTimeout(15_000)
  page.setDefaultNavigationTimeout(20_000)
  return page
}

test.describe('Region-tier full journey (staging)', () => {
  test.setTimeout(420_000)

  test('leader → group → schools journey', async ({ browser }) => {
    // Independent browser contexts per persona — mirrors real multi-user isolation.
    const leaderCtx = await browser.newContext()
    const leaderPage = boundTimeouts(await leaderCtx.newPage())
    const schoolAdminCtx = await browser.newContext()
    const schoolAdminPage = boundTimeouts(await schoolAdminCtx.newPage())
    const leader2Ctx = await browser.newContext()
    const leader2Page = boundTimeouts(await leader2Ctx.newPage())

    const groupName = `E2E Region ${RUN_ID}`
    const leaderEmail = syntheticEmail('leader1')
    const schoolAdminEmail = syntheticEmail('school-admin')
    const leader2Email = syntheticEmail('leader2')
    const ssiAdminActorEmail = syntheticEmail('ssi-admin-actor')

    let inviteCode1 = ''
    let leaderUserId = ''
    let leaderGroupId = ''
    let mintedLabelledCode = ''
    let mintedUnlabelledCode = ''
    let schoolAdminUserId = ''
    let redeemedSchoolId = ''
    let leader2GroupId = ''
    let directCreatedSchoolId = ''

    // ---------------------------------------------------------------
    // Step 1: ssi_admin mints a govt_admin invite code with a group name.
    // No test ssi_admin session exists on staging, so — per the task's
    // documented fallback — the invite_codes row is inserted directly via
    // the service-role key. This is byte-for-byte what
    // POST /api/admin/create-govt-admin does server-side (same table, same
    // shape, group_id left null so the leader names their own group at
    // redemption per region-tier-design.md §1c) — the only thing skipped is
    // the ssi_admin JWT check in front of it, which this test isn't scoped
    // to exercise.
    // ---------------------------------------------------------------
    let ssiAdminActorId = ''
    await step('1', 'ssi_admin mints govt_admin invite code', async () => {
      // invite_codes.created_by is NOT NULL text (an auth uid). No test
      // ssi_admin session exists on staging, so a synthetic actor user
      // stands in purely to satisfy that FK/NOT NULL — it never gets a
      // learners row or the ssi_admin role, and is deleted in cleanup.
      ssiAdminActorId = await createSyntheticUser(ssiAdminActorEmail, ledger)

      const part = () => Math.random().toString(36).slice(2, 5).toUpperCase()
      inviteCode1 = `${part()}-${part()}`
      const { data, error } = await admin
        .from('invite_codes')
        .insert({
          code: inviteCode1,
          code_type: 'govt_admin',
          created_by: ssiAdminActorId,
          grants_group_id: null,
          max_uses: 1,
          metadata: {
            organization_name: groupName,
            recipient_email: leaderEmail,
            recipient_name: 'E2E Leader One',
          },
        })
        .select('id')
        .single()
      if (error || !data) throw new Error(`invite_codes insert failed: ${error?.message}`)
      ledger.inviteCodeIds.push(data.id as string)
    })

    // ---------------------------------------------------------------
    // Step 2: leader opens /group/<code>, sees the landing hero, signs up,
    // group gets created, "Name your group" first-run card appears, renames.
    // ---------------------------------------------------------------
    await step(
      '2a',
      '/group/:code landing hero renders with group name',
      async () => {
        await leaderPage.goto(`/group/${inviteCode1}`)
        await expect(leaderPage.locator('.landing-heading')).toBeVisible({ timeout: 20_000 })
        await expect(leaderPage.locator('.landing-sub')).toContainText(groupName, { timeout: 10_000 })
      },
      leaderPage
    )

    await step(
      '2b',
      'leader signs up via OTP and redeems',
      async () => {
        leaderUserId = await createSyntheticUser(leaderEmail, ledger)
        await signInViaOtp(leaderPage, leaderEmail)
        await expect(leaderPage.locator('.success-title')).toBeVisible({ timeout: 20_000 })
        // RedeemCode's own 4s-delayed router.push(redirectTo) races an
        // app-level post-sign-in redirect and can lose (observed landing on
        // '/' instead of '/schools' on staging — logged as a break in the
        // report, not fixed here). Navigate explicitly so the rest of the
        // journey isn't coupled to that race.
        await leaderPage.goto('/schools')
        // Dashboard branches on isGovtAdmin, which resolves after an async
        // role fetch on top of the fresh reload — give it real headroom.
        await expect(leaderPage.locator('.name-group-card, .govt-schools-grid, .add-schools-card').first()).toBeVisible({ timeout: 40_000 })
      },
      leaderPage
    )

    await step('2c', 'govt_admins row created with group_id set (DB)', async () => {
      const { data, error } = await admin
        .from('govt_admins')
        .select('id, group_id, organization_name')
        .eq('user_id', leaderUserId)
        .maybeSingle()
      if (error || !data) throw new Error(`govt_admins row not found: ${error?.message}`)
      ledger.govtAdminIds.push(data.id as string)
      if (!data.group_id) throw new Error('govt_admins.group_id is null — group was not created at redemption')
      leaderGroupId = data.group_id as string
      ledger.groupIds.push(leaderGroupId)
      await markLearnerInternal(leaderUserId, ledger)
    })

    await step(
      '2d',
      '"Name your group" first-run card appears (group.name_confirmed=false)',
      async () => {
        await expect(leaderPage.locator('.name-group-card')).toBeVisible({ timeout: 20_000 })
      },
      leaderPage
    )

    const renamedGroupName = `${groupName} (renamed)`
    await step(
      '2e',
      'leader renames group and it saves',
      async () => {
        await leaderPage.locator('.name-group-card input').fill(renamedGroupName)
        await leaderPage.locator('.name-group-card .btn-play').click()
        await expect(leaderPage.locator('.name-group-card')).toBeHidden({ timeout: 20_000 })
        const { data, error } = await admin.from('groups').select('name, name_confirmed').eq('id', leaderGroupId).single()
        if (error || !data) throw new Error(`groups row read failed: ${error?.message}`)
        if (data.name !== renamedGroupName) throw new Error(`expected group name "${renamedGroupName}", got "${data.name}"`)
        if (data.name_confirmed !== true) throw new Error('groups.name_confirmed did not flip to true')
      },
      leaderPage
    )

    // ---------------------------------------------------------------
    // Step 3: leader mints 2 school links (one labelled), grants_group_id
    // stamped server-side.
    // ---------------------------------------------------------------
    await step(
      '3a',
      'leader mints a labelled school link',
      async () => {
        const label = `E2E School ${RUN_ID}`
        await leaderPage.locator('.add-schools-row input').fill(label)
        await leaderPage.getByRole('button', { name: 'Invite a school' }).click()
        await expect(leaderPage.locator('.schools-subtle code')).toBeVisible({ timeout: 20_000 })
        const linkText = await leaderPage.locator('.schools-subtle code').innerText()
        mintedLabelledCode = linkText.trim().split('/').pop() || ''
        if (!mintedLabelledCode) throw new Error(`could not parse minted code from "${linkText}"`)
      },
      leaderPage
    )

    await step(
      '3b',
      'leader mints an unlabelled school link',
      async () => {
        await leaderPage.locator('.add-schools-row input').fill('')
        await leaderPage.getByRole('button', { name: 'Invite a school' }).click()
        await leaderPage.waitForTimeout(1500) // let fetchSchoolLinks settle
        const linkText = await leaderPage.locator('.schools-subtle code').innerText()
        mintedUnlabelledCode = linkText.trim().split('/').pop() || ''
        if (!mintedUnlabelledCode || mintedUnlabelledCode === mintedLabelledCode) {
          throw new Error(`second mint did not produce a new code (got "${mintedUnlabelledCode}")`)
        }
      },
      leaderPage
    )

    await step('3c', 'both minted codes stamped grants_group_id = leader\'s own group (DB)', async () => {
      for (const code of [mintedLabelledCode, mintedUnlabelledCode]) {
        const { data, error } = await admin
          .from('invite_codes')
          .select('id, grants_group_id, code_type')
          .eq('code', code)
          .single()
        if (error || !data) throw new Error(`invite_codes row for ${code} not found: ${error?.message}`)
        ledger.inviteCodeIds.push(data.id as string)
        if (data.code_type !== 'school_admin') throw new Error(`code ${code} has wrong code_type ${data.code_type}`)
        if (data.grants_group_id !== leaderGroupId) {
          throw new Error(`code ${code} grants_group_id=${data.grants_group_id}, expected leader's group ${leaderGroupId}`)
        }
      }
    })

    // ---------------------------------------------------------------
    // Step 4: synthetic school admin redeems the labelled link end to end.
    // ---------------------------------------------------------------
    await step(
      '4a',
      'school admin redeems the labelled link',
      async () => {
        await schoolAdminPage.goto(`/redeem/${mintedLabelledCode}`)
        await expect(schoolAdminPage.locator('.code-title')).toBeVisible({ timeout: 20_000 })
        schoolAdminUserId = await createSyntheticUser(schoolAdminEmail, ledger)
        await signInViaOtp(schoolAdminPage, schoolAdminEmail)
        await expect(schoolAdminPage.locator('.success-title')).toBeVisible({ timeout: 20_000 })
      },
      schoolAdminPage
    )

    await step('4b', 'school row created with group_id set + both join codes registered (DB)', async () => {
      const { data, error } = await admin
        .from('schools')
        .select('id, group_id, teacher_join_code, admin_join_code, invite_code_id')
        .eq('admin_user_id', schoolAdminUserId)
        .maybeSingle()
      if (error || !data) throw new Error(`schools row not found for admin_user_id=${schoolAdminUserId}: ${error?.message}`)
      redeemedSchoolId = data.id as string
      ledger.schoolIds.push(redeemedSchoolId)
      if (data.group_id !== leaderGroupId) throw new Error(`school.group_id=${data.group_id}, expected ${leaderGroupId}`)

      const { data: codes, error: codesErr } = await admin
        .from('invite_codes')
        .select('code, code_type')
        .in('code', [data.teacher_join_code, data.admin_join_code])
      if (codesErr) throw new Error(`join-code lookup failed: ${codesErr.message}`)
      const types = new Set((codes || []).map((c: any) => c.code_type))
      if (!types.has('teacher')) throw new Error('teacher join code not registered in invite_codes')
      if (!types.has('school_admin_join')) throw new Error('admin join code not registered in invite_codes')

      await markLearnerInternal(schoolAdminUserId, ledger)
    })

    // The admin_join_code redemption path (/schools straight, per redeem.ts)
    // never runs onboarding/provision, so the trial clock is only ever set
    // by the school_admin invite-code path completing onboarding. That
    // onboarding is a separate, course-picking UI surface this test doesn't
    // own; it drives the SAME endpoint the Onboarding.vue UI calls
    // (POST /api/onboarding/provision), using the school admin's own
    // just-established browser session token, so the assertion below
    // exercises the real server code path that sets the trial clock without
    // re-implementing an unrelated feature's UI.
    await step('4c', 'onboarding/provision sets the platform trial clock', async () => {
      const token = await getAccessTokenFromPage(schoolAdminPage)
      if (!token) throw new Error('could not read school admin session token from browser localStorage')
      const courseCode = await pickAnyLiveCourseCode()
      const res = await schoolAdminPage.request.post('/api/onboarding/provision', {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        data: { track: 'school', course_code: courseCode },
      })
      if (!res.ok()) throw new Error(`provision failed: ${res.status()} ${await res.text()}`)
      const { data, error } = await admin
        .from('schools')
        .select('platform_status, platform_expires_at')
        .eq('id', redeemedSchoolId)
        .single()
      if (error || !data) throw new Error(`schools re-read failed: ${error?.message}`)
      if (data.platform_status !== 'trial' || !data.platform_expires_at) {
        throw new Error(`platform trial clock not set: status=${data.platform_status} expires=${data.platform_expires_at}`)
      }
    })

    // ---------------------------------------------------------------
    // Step 5: leader direct-creates a school; group-owned, vacant admin
    // seat, appears in the leader rollup.
    // ---------------------------------------------------------------
    await step(
      '5a',
      'leader direct-creates a school via "Create school"',
      async () => {
        const name = `E2E Direct School ${RUN_ID}`
        await leaderPage.locator('.add-schools-row input').fill(name)
        await leaderPage.getByRole('button', { name: 'Create school' }).click()
        await expect(leaderPage.getByText(name)).toBeVisible({ timeout: 20_000 })
      },
      leaderPage
    )

    await step('5b', 'direct-created school is group-owned with vacant admin seat (DB)', async () => {
      const { data, error } = await admin
        .from('schools')
        .select('id, group_id, admin_user_id, teacher_join_code, admin_join_code')
        .eq('group_id', leaderGroupId)
        .neq('id', redeemedSchoolId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error || !data) throw new Error(`direct-created school not found: ${error?.message}`)
      directCreatedSchoolId = data.id as string
      ledger.schoolIds.push(directCreatedSchoolId)
      if (data.admin_user_id !== null) throw new Error(`admin_user_id should be vacant (null), got ${data.admin_user_id}`)
      if (!data.teacher_join_code || !data.admin_join_code) throw new Error('join codes missing on direct-created school')
    })

    await step(
      '5c',
      'both schools appear in the leader rollup',
      async () => {
        await leaderPage.reload()
        await expect(leaderPage.locator('.govt-schools-grid')).toBeVisible({ timeout: 20_000 })
        const tileCount = await leaderPage.locator('.govt-tile').count()
        if (tileCount < 2) throw new Error(`expected >=2 school tiles in rollup, found ${tileCount}`)
      },
      leaderPage
    )

    // ---------------------------------------------------------------
    // Step 6: NEGATIVE — a second leader (different group) forges a
    // cross-group payload; server must ignore it and stamp its own group.
    // ---------------------------------------------------------------
    let inviteCode2 = ''
    await step('6a', 'ssi_admin mints a second govt_admin invite code (leader 2)', async () => {
      const part = () => Math.random().toString(36).slice(2, 5).toUpperCase()
      inviteCode2 = `${part()}-${part()}`
      const { data, error } = await admin
        .from('invite_codes')
        .insert({
          code: inviteCode2,
          code_type: 'govt_admin',
          created_by: ssiAdminActorId,
          grants_group_id: null,
          max_uses: 1,
          metadata: { organization_name: `E2E Region 2 ${RUN_ID}`, recipient_email: leader2Email, recipient_name: 'E2E Leader Two' },
        })
        .select('id')
        .single()
      if (error || !data) throw new Error(`invite_codes insert failed: ${error?.message}`)
      ledger.inviteCodeIds.push(data.id as string)
    })

    await step(
      '6b',
      'leader 2 signs up and gets their own group',
      async () => {
        await leader2Page.goto(`/group/${inviteCode2}`)
        const leader2UserId = await createSyntheticUser(leader2Email, ledger)
        await signInViaOtp(leader2Page, leader2Email)
        await expect(leader2Page.locator('.success-title')).toBeVisible({ timeout: 20_000 })
        const { data, error } = await admin.from('govt_admins').select('id, group_id').eq('user_id', leader2UserId).maybeSingle()
        if (error || !data?.group_id) throw new Error(`leader 2 govt_admins row/group missing: ${error?.message}`)
        ledger.govtAdminIds.push(data.id as string)
        leader2GroupId = data.group_id as string
        ledger.groupIds.push(leader2GroupId)
        if (leader2GroupId === leaderGroupId) throw new Error('leader 2 was assigned leader 1\'s group — test setup bug')
        await markLearnerInternal(leader2UserId, ledger)
      },
      leader2Page
    )

    await step('6c', 'forged grants_group_id on /api/invite/create is ignored — server stamps caller\'s own group', async () => {
      const token = await getAccessTokenFromPage(leader2Page)
      if (!token) throw new Error('could not read leader 2 session token')
      const res = await leader2Page.request.post('/api/invite/create', {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        data: {
          code_type: 'school_admin',
          // FORGED — attempting to mint a link for leader 1's group.
          grants_group_id: leaderGroupId,
          metadata: { school_name: 'Forged Cross-Group School' },
        },
      })
      if (!res.ok()) throw new Error(`invite/create unexpectedly rejected the request outright: ${res.status()} ${await res.text()}`)
      const body = await res.json()
      const { data, error } = await admin.from('invite_codes').select('id, grants_group_id').eq('code', body.code).single()
      if (error || !data) throw new Error(`minted forged-attempt code not found: ${error?.message}`)
      ledger.inviteCodeIds.push(data.id as string)
      if (data.grants_group_id === leaderGroupId) {
        throw new Error('SECURITY: server honoured the forged grants_group_id — leader 2 minted a code for leader 1\'s group')
      }
      if (data.grants_group_id !== leader2GroupId) {
        throw new Error(`expected server to stamp leader 2's own group ${leader2GroupId}, got ${data.grants_group_id}`)
      }
    })

    await step('6d', 'govt/create-school has no group_id field to forge — always derives caller\'s own group (DB)', async () => {
      const token = await getAccessTokenFromPage(leader2Page)
      if (!token) throw new Error('could not read leader 2 session token')
      const res = await leader2Page.request.post('/api/govt/create-school', {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        // FORGED — the endpoint doesn't accept group_id at all; confirm the extra field is silently ignored, not honoured.
        data: { school_name: 'Forged Direct School', group_id: leaderGroupId },
      })
      if (!res.ok()) throw new Error(`govt/create-school failed: ${res.status()} ${await res.text()}`)
      const body = await res.json()
      ledger.schoolIds.push(body.school.id)
      if (body.school.group_id === leaderGroupId) {
        throw new Error('SECURITY: govt/create-school honoured a forged group_id — leader 2 created a school in leader 1\'s group')
      }
      if (body.school.group_id !== leader2GroupId) {
        throw new Error(`expected server-derived group ${leader2GroupId}, got ${body.school.group_id}`)
      }
    })

    await leaderCtx.close()
    await schoolAdminCtx.close()
    await leader2Ctx.close()
  })

  test.afterAll(async () => {
    fs.mkdirSync(REPORT_DIR, { recursive: true })
    const jsonPath = path.join(REPORT_DIR, 'report.json')
    fs.writeFileSync(jsonPath, JSON.stringify({ runId: RUN_ID, results, ledger }, null, 2))

    const passCount = results.filter((r) => r.status === 'pass').length
    const failCount = results.filter((r) => r.status === 'fail').length
    const lines = [
      `# Region-tier E2E journey — run ${RUN_ID}`,
      '',
      `${passCount} passed, ${failCount} failed, ${results.length} total.`,
      '',
      '| Step | Name | Status | Detail |',
      '|---|---|---|---|',
      ...results.map((r) => `| ${r.step} | ${r.name} | ${r.status.toUpperCase()} | ${(r.detail || '').replace(/\|/g, '\\|')} |`),
    ]
    const mdPath = path.join(REPORT_DIR, 'report.md')
    fs.writeFileSync(mdPath, lines.join('\n'))
    console.log(`\n=== Region-tier e2e report: ${mdPath} ===\n${lines.join('\n')}\n`)

    const { errors } = await cleanup(ledger)
    if (errors.length) {
      console.error('[cleanup] errors (manual follow-up needed):', errors)
      fs.writeFileSync(path.join(REPORT_DIR, 'cleanup-errors.json'), JSON.stringify(errors, null, 2))
    } else {
      console.log('[cleanup] all synthetic rows removed cleanly.')
    }
  })
})
