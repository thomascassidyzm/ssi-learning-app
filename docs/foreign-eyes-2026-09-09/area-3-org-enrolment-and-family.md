# Area 3 — org enrolment and family

Baseline `4555418a`. Source inspection only. The funded org-enrolment write-swallow fix is present; FE3-04 and FE3-05 below explicitly concern incomplete coverage of its new repair mechanism, not a re-report of the old swallowed error.

## FE3-01 — An expired personal subscription blocks a paid family place

**Confidence: certain for the stated database state.** The resolver's own comment explicitly prioritises any personal row; that is the cause, not reassurance.

1. A learner previously bought Premium; their `subscriptions` row remains with expired `current_period_end` or non-active status.
2. A paying Family owner invites them. The membership attaches successfully; that path does not exclude previous subscribers.
3. The learner requests `/api/subscription` or a premium course bundle.
4. The effective-subscription helper finds the old personal row and returns before examining their active family membership. Callers apply expiry/status checks and deny paid access.

**Loss:** a place on a paid Family plan covers a never-subscribed relative but fails for a former subscriber; cancelling one's own redundant subscription does not make the family take over while the row remains. No school payment prerequisite.

**What would settle it:** inspect an active `family_members` row whose member has an expired/cancelled personal subscription and whose owner has a live Family plan. The resolver deterministically returns the member's inactive row. Reject only if a separate invariant deletes every inactive personal row before family use; no such invariant appears in the inspected resolver/schema.

`api/_utils/familyAccess.ts:100–117`

```text
100: ): Promise<EffectiveSubscriptionResult> {
101:   const { data: own } = await supabase
102:     .from('subscriptions')
103:     .select(columns)
104:     .eq('learner_id', learnerId)
105:     .maybeSingle()
106: 
107:   if (own) return { sub: own as unknown as SubscriptionRow, viaFamily: false, coverEndsAt: null }
108: 
109:   const { data: membership } = await supabase
110:     .from('family_members')
111:     .select('owner_learner_id')
112:     .eq('member_learner_id', learnerId)
113:     .eq('status', 'active')
114:     .is('removed_at', null)
115:     .maybeSingle()
116: 
117:   if (!membership?.owner_learner_id) return { sub: null, viaFamily: false, coverEndsAt: null }
```

`api/_utils/courseAccess.ts:87–106`

```text
87:     const [subResult, entRes] = await Promise.all([
88:       resolveEffectiveSubscription(supabase, learner.id, 'status, current_period_end'),
89:       supabase
90:         .from('user_entitlements')
91:         .select('access_type, granted_courses, expires_at')
92:         .eq('learner_id', learner.id),
93:     ])
94: 
95:     if (subResult.sub) {
96:       const isActive =
97:         subResult.sub.status === 'active' &&
98:         (!subResult.sub.current_period_end || new Date(subResult.sub.current_period_end) > new Date())
99:       subscription = { isActive, tier: isActive ? 'paid' : 'free' }
100:     }
101: 
102:     entitlements = (entRes.data || []).map((e: any) => ({
103:       accessType: e.access_type,
104:       grantedCourses: e.granted_courses,
105:       expiresAt: e.expires_at,
106:     }))
```

`api/family/invite.ts:135–151`

```text
135:   // Best-effort immediate attach: an existing account whose verified email
136:   // matches gets covered right away — no need to wait for their next sign-in.
137:   let attachedNow = false
138:   try {
139:     const { data: existingLearners } = await supabase
140:       .from('learners')
141:       .select('id, verified_emails')
142:       .contains('verified_emails', [normalizedEmail])
143: 
144:     for (const candidate of existingLearners || []) {
145:       const emails: string[] = (candidate.verified_emails as string[] | null) || []
146:       if (!emails.some((e) => e.toLowerCase().trim() === normalizedEmail)) continue
147:       if (candidate.id === ownerLearnerId) continue // can't invite yourself (checked above, belt+braces)
148: 
149:       const { attached } = await attachPendingInvitesForEmail(supabase, candidate.id as string, normalizedEmail)
150:       if (attached > 0) attachedNow = true
151:       break // verified_emails is effectively unique per real person; first match wins
```

## FE3-02 — A stranger can occupy someone's only family membership without paying or obtaining acceptance

**Confidence: likely.** The server sequence is explicit; whether this happens to current users was not checked.

1. An ordinary authenticated learner, with no Family subscription, knows a target's sign-in email. The target is not already in a family.
2. The caller posts that email to `/api/family/invite`. The endpoint checks authentication, caller identity and seat count, but never checks a Family subscription.
3. For an existing matching `verified_emails` row, immediate attachment writes an active membership under the caller. For a future account, `/api/access/claim` performs the same attachment on sign-in. The target accepts no family-specific invitation.
4. A real paying relative later invites the target. `isInAnyLiveFamily` sees the stranger's membership and refuses attachment. The stranger supplies no cover because they have no subscription.

**Loss/gain:** the target loses automatic entry to their legitimate paid family until they leave the unwanted membership; the stranger gains the target's displayed name through their family listing. This does NOT let the stranger generate a sign-in link for the adult: `is_child_account` remains false. Existing membership cannot be stolen. The target can recover via authenticated `/api/family/leave`; this is an obstruction, not permanent account takeover.

**What would settle it:** confirm the deployed family table has no additional trigger requiring an active payer/recipient acceptance, then follow the quoted invite/attach predicates for an ordinary account and an unclaimed target. The recorded schema grants table access only to service role and has no such trigger.

`api/family/invite.ts:48–67`

```text
48:   const authResult = await verifyAuthToken(req)
49:   if (!authResult.valid || !authResult.userId) {
50:     res.status(401).json({ error: authResult.error || 'Unauthorized' })
51:     return
52:   }
53: 
54:   const rawEmail = (req.body || {}).email
55:   if (typeof rawEmail !== 'string' || !EMAIL_RE.test(rawEmail.trim())) {
56:     res.status(400).json({ error: 'A valid email is required' })
57:     return
58:   }
59:   const normalizedEmail = rawEmail.toLowerCase().trim()
60: 
61:   const supabase = createClient(supabaseUrl, supabaseServiceKey)
62: 
63:   const ownerLearnerId = await resolveLearnerId(supabase, authResult.userId)
64:   if (!ownerLearnerId) {
65:     res.status(404).json({ error: 'Learner account not found' })
66:     return
67:   }
```

`api/family/invite.ts:82–106`

```text
82:   const usedSeats = await countUsedSeats(supabase, ownerLearnerId)
83:   if (usedSeats >= FAMILY_SEAT_CAP) {
84:     res.status(400).json({ error: `Family is full (${FAMILY_SEAT_CAP} seats including you)` })
85:     return
86:   }
87: 
88:   // AN INVITE THAT ALREADY EXISTS IS RE-SENT, NOT REFUSED. The dedupe index
89:   // used to answer 409 "Already invited" — which is exactly the moment an
90:   // owner is retyping the address because the mail has not turned up (Tom,
91:   // 2026-09-07: Resend had delivered it within a second; the app could only
92:   // say "Invited"). Re-posting a live invite now sends the mail again and
93:   // says so. An invite that has already been claimed is the one genuine
94:   // "already in your family" — that stays a 409, with words a person can act on.
95:   let inserted: Record<string, unknown> | null = null
96:   let resent = false
97:   const { data: freshRow, error: insertErr } = await supabase
98:     .from('family_members')
99:     .insert({
100:       owner_learner_id: ownerLearnerId,
101:       invited_email: normalizedEmail,
102:       is_child_account: false,
103:       status: 'invited',
104:     })
105:     .select('*')
106:     .single()
```

`api/family/invite.ts:135–151`

```text
135:   // Best-effort immediate attach: an existing account whose verified email
136:   // matches gets covered right away — no need to wait for their next sign-in.
137:   let attachedNow = false
138:   try {
139:     const { data: existingLearners } = await supabase
140:       .from('learners')
141:       .select('id, verified_emails')
142:       .contains('verified_emails', [normalizedEmail])
143: 
144:     for (const candidate of existingLearners || []) {
145:       const emails: string[] = (candidate.verified_emails as string[] | null) || []
146:       if (!emails.some((e) => e.toLowerCase().trim() === normalizedEmail)) continue
147:       if (candidate.id === ownerLearnerId) continue // can't invite yourself (checked above, belt+braces)
148: 
149:       const { attached } = await attachPendingInvitesForEmail(supabase, candidate.id as string, normalizedEmail)
150:       if (attached > 0) attachedNow = true
151:       break // verified_emails is effectively unique per real person; first match wins
```

`api/_utils/familyMembership.ts:98–123`

```text
98:   const { data: pending } = await supabase
99:     .from('family_members')
100:     .select('id, owner_learner_id')
101:     .eq('invited_email', normalizedEmail)
102:     .eq('status', 'invited')
103:     .is('removed_at', null)
104: 
105:   if (!pending || pending.length === 0) return { attached: 0 }
106: 
107:   // Already claimed elsewhere → leave every pending invite untouched, no steal.
108:   if (await isInAnyLiveFamily(supabase, learnerId)) return { attached: 0 }
109: 
110:   let attached = 0
111:   for (const invite of pending as Array<{ id: string; owner_learner_id: string }>) {
112:     // Belt + braces: re-check the seat cap fresh for each owner right before
113:     // attaching (the row being claimed is already counted as a used seat, so
114:     // this only ever blocks a genuine race-created overflow, never the
115:     // ordinary claim itself).
116:     const usedSeats = await countUsedSeats(supabase, invite.owner_learner_id)
117:     if (usedSeats > FAMILY_SEAT_CAP) continue
118: 
119:     const { error } = await supabase
120:       .from('family_members')
121:       .update({ member_learner_id: learnerId, status: 'active', updated_at: new Date().toISOString() })
122:       .eq('id', invite.id)
123:       .eq('status', 'invited') // idempotency: no-op if another request already claimed it
```

`api/family/index.ts:84–94`

```text
84:   const rows = await liveFamilyRows(supabase, learnerId)
85: 
86:   const memberLearnerIds = rows.map((r) => r.member_learner_id).filter((id): id is string => !!id)
87:   const displayNames = new Map<string, string>()
88:   if (memberLearnerIds.length > 0) {
89:     const { data: learners } = await supabase
90:       .from('learners')
91:       .select('id, display_name')
92:       .in('id', memberLearnerIds)
93:     for (const l of learners || []) displayNames.set(l.id as string, (l.display_name as string) || '')
94:   }
```

`api/family/index.ts:127–133`

```text
127:   const members = rows.map((r) => ({
128:     id: r.id,
129:     status: r.status,
130:     is_child_account: r.is_child_account,
131:     invited_email: r.invited_email,
132:     display_name: r.member_learner_id ? (displayNames.get(r.member_learner_id) ?? null) : null,
133:     created_at: r.created_at,
```

`api/family/leave.ts:39–51`

```text
39:   const learnerId = await resolveLearnerId(supabase, authResult.userId)
40:   if (!learnerId) {
41:     res.status(404).json({ error: 'Learner account not found' })
42:     return
43:   }
44: 
45:   const { data: updated, error } = await supabase
46:     .from('family_members')
47:     .update({ status: 'removed', removed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
48:     .eq('member_learner_id', learnerId)
49:     .is('removed_at', null)
50:     .select('*')
51:     .maybeSingle()
```

## FE3-03 — Concurrent child creation can put more than six covered people on one family plan

**Confidence: likely.** The race is fully specified; production triggers were not queried.

1. A paying Family owner has five used seats (owner plus four live members), leaving one place.
2. They submit two `/api/family/create-child` requests concurrently. Both finish `countUsedSeats` before either inserts a membership; both observe five and pass.
3. Each request creates a distinct auth user, learner and active membership. Neither inserts through `attachPendingInvitesForEmail`, so that helper's second cap check cannot help.
4. The family now has seven used seats. Each child's effective-subscription check only requires their live membership and the owner's active plan; it never recounts seats.

**Gain:** extra actively covered child accounts for the same six-person price. A single accidental double-submit can also overfill the family. Distinct child UUIDs satisfy both recorded unique indexes.

**What would settle it:** inspect live `family_members` triggers/constraints for an owner-level serialised cap. If they match the recorded migration, no database condition prevents the interleaving above. The prior school-seat race SEC0901-B-02 is a separate table/path; this is the Family child path, not that re-filed issue.

`api/_utils/familyMembership.ts:42–63`

```text
42: export async function liveFamilyRows(
43:   supabase: ServiceClient,
44:   ownerLearnerId: string,
45: ): Promise<FamilyMemberRow[]> {
46:   const { data } = await supabase
47:     .from('family_members')
48:     .select('*')
49:     .eq('owner_learner_id', ownerLearnerId)
50:     .is('removed_at', null)
51:   return (data as FamilyMemberRow[] | null) ?? []
52: }
53: 
54: /**
55:  * Seats currently used: 1 (the owner) + every live invited/active member.
56:  * 'invited' counts — an unclaimed invite reserves a seat, matching the
57:  * spec's own worked example ("5 seats used of six" with one still pending).
58:  */
59: export async function countUsedSeats(
60:   supabase: ServiceClient,
61:   ownerLearnerId: string,
62: ): Promise<number> {
63:   return 1 + (await liveFamilyRows(supabase, ownerLearnerId)).length
```

`api/family/create-child.ts:58–81`

```text
58:   const ownerLearnerId = await resolveLearnerId(supabase, authResult.userId)
59:   if (!ownerLearnerId) {
60:     res.status(404).json({ error: 'Learner account not found' })
61:     return
62:   }
63: 
64:   const usedSeats = await countUsedSeats(supabase, ownerLearnerId)
65:   if (usedSeats >= FAMILY_SEAT_CAP) {
66:     res.status(400).json({ error: `Family is full (${FAMILY_SEAT_CAP} seats including you)` })
67:     return
68:   }
69: 
70:   const syntheticEmail = `fam-${randomUUID()}@${SYNTHETIC_EMAIL_DOMAIN}`
71: 
72:   // WHAT GOES WRONG HERE IS SAID IN FULL. "Failed to create child account" was
73:   // the whole of what a parent saw on 2026-09-07 — no cause, nothing to do
74:   // next. Every failure below says what did not happen and that nothing was
75:   // left half-made, so trying again is safe and obviously so.
76:   const tryAgain = `We could not set up ${displayName}'s account, and nothing was saved. Please try again in a moment.`
77: 
78:   const { data: createdUser, error: createUserErr } = await supabase.auth.admin.createUser({
79:     email: syntheticEmail,
80:     email_confirm: true, // never sent, never seen — synthetic address we own
81:     user_metadata: { family_child: true, display_name: displayName },
```

`api/family/create-child.ts:114–129`

```text
114:   const { data: membership, error: memberErr } = await supabase
115:     .from('family_members')
116:     .insert({
117:       owner_learner_id: ownerLearnerId,
118:       member_learner_id: childLearner.id,
119:       is_child_account: true,
120:       status: 'active',
121:     })
122:     .select('*')
123:     .single()
124: 
125:   if (memberErr || !membership) {
126:     console.error('[family/create-child] membership creation failed:', memberErr)
127:     await supabase.auth.admin.deleteUser(childUserId).catch(() => {})
128:     res.status(500).json({ error: tryAgain, detail: 'membership' })
129:     return
```

`supabase/migrations/20260710_family_members.sql:22–49`

```text
22: CREATE TABLE public.family_members (
23:     id uuid DEFAULT gen_random_uuid() NOT NULL,
24:     owner_learner_id uuid NOT NULL,
25:     member_learner_id uuid,
26:     invited_email text,
27:     is_child_account boolean DEFAULT false NOT NULL,
28:     status text DEFAULT 'invited'::text NOT NULL,
29:     created_at timestamp with time zone DEFAULT now() NOT NULL,
30:     updated_at timestamp with time zone DEFAULT now() NOT NULL,
31:     removed_at timestamp with time zone,
32:     CONSTRAINT family_members_pkey PRIMARY KEY (id),
33:     CONSTRAINT family_members_status_check CHECK ((status = ANY (ARRAY['invited'::text, 'active'::text, 'removed'::text]))),
34:     CONSTRAINT family_members_owner_learner_id_fkey FOREIGN KEY (owner_learner_id) REFERENCES public.learners(id),
35:     CONSTRAINT family_members_member_learner_id_fkey FOREIGN KEY (member_learner_id) REFERENCES public.learners(id)
36: );
37: 
38: COMMENT ON TABLE public.family_members IS 'SSi Family plan membership (FAMILY-PLAN-SPEC.md). The umbrella IS the payer''s subscriptions row (plan_name = ''SSi Family''); this table is the only new data surface. RLS ON, no policies — service-role-only, all access via /api/family/* endpoints (CLAUDE.md rule 7 posture + the "hierarchy authz = endpoints" doctrine). Removal is a stamp (removed_at + status=''removed''), never a delete.';
39: 
40: CREATE UNIQUE INDEX family_members_invite_dedupe ON public.family_members USING btree (owner_learner_id, invited_email) WHERE ((removed_at IS NULL) AND (invited_email IS NOT NULL));
41: CREATE UNIQUE INDEX family_members_one_family ON public.family_members USING btree (member_learner_id) WHERE ((removed_at IS NULL) AND (member_learner_id IS NOT NULL));
42: CREATE INDEX family_members_owner_idx ON public.family_members USING btree (owner_learner_id);
43: 
44: ALTER TABLE public.family_members ENABLE ROW LEVEL SECURITY;
45: 
46: -- Explicit posture, both layers: revoke the grant-open creation default so
47: -- only owner + service_role hold any privilege (DECISIONS.md 2026-07-10).
48: REVOKE ALL ON TABLE public.family_members FROM anon, authenticated;
49: GRANT ALL ON TABLE public.family_members TO service_role;
```

`api/_utils/familyAccess.ts:109–117`

```text
109:   const { data: membership } = await supabase
110:     .from('family_members')
111:     .select('owner_learner_id')
112:     .eq('member_learner_id', learnerId)
113:     .eq('status', 'active')
114:     .is('removed_at', null)
115:     .maybeSingle()
116: 
117:   if (!membership?.owner_learner_id) return { sub: null, viaFamily: false, coverEndsAt: null }
```

`api/_utils/familyAccess.ts:126–153`

```text
126:   const { data: ownerSub } = await supabase
127:     .from('subscriptions')
128:     .select(ownerColumns(columns))
129:     .eq('learner_id', membership.owner_learner_id)
130:     .eq('status', 'active')
131:     .maybeSingle()
132: 
133:   if (!ownerSub) return { sub: null, viaFamily: false, coverEndsAt: null }
134: 
135:   const row = ownerSub as any
136:   if (row.current_period_end && new Date(row.current_period_end).getTime() <= Date.now()) {
137:     return { sub: null, viaFamily: false, coverEndsAt: null } // owner's period has lapsed — grants nothing
138:   }
139: 
140:   const sub = ownerSub as unknown as SubscriptionRow
141: 
142:   if (row.plan_name === 'SSi Family') {
143:     // Live family. Something may still be ending: a scheduled change to
144:     // Premium ends the member's cover 30 days after the paid period, and an
145:     // outright cancellation ends it AT the paid period — there, nobody is
146:     // paying for anything afterwards, so there is no grace to give.
147:     const coverEndsAt =
148:       row.scheduled_plan_name && row.scheduled_plan_at
149:         ? familyCoverEndsAt(row.scheduled_plan_at)
150:         : row.cancel_at_period_end
151:           ? (row.current_period_end as string | null)
152:           : null
153:     return { sub, viaFamily: true, coverEndsAt }
```

## FE3-04 — Incomplete enrolment fix: a grant expiring tomorrow is accepted as the promised free year

**Confidence: certain for the specified grants; likely user impact.** The newly added cron limits the ordinary interruption if it runs and reaches the learner.

1. A learner has a short-lived personal course/full entitlement covering the funder's courses, expiring tomorrow.
2. They enrol for a funded year. `ensureOrgEntitlement` calls `coversCourses`, which asks only whether the old grant is live *now*, not whether it covers the enrolment's `free_access_until`.
3. The helper returns `already` and writes no funded-year grant; the enrolment response still promises the full year.
4. Tomorrow the old grant expires. The premium content gate filters it out. Until the learner replays enrolment or the repair cron reaches them, they have no direct course entitlement despite being enrolled for a year.

**Loss:** an interruption to funded access and possible upgrade prompts during a promised free year. With a healthy daily cron reaching the row, expect a gap until the next run, not automatically a whole lost year. Separate active org/cascade grants can mask it.

**What would settle it:** inspect an enrolment whose only matching entitlement expires before `free_access_until`; `coversCourses` takes no promised end-date argument. Verify whether independent grants cover that particular learner before asserting actual lockout.

`api/_utils/orgEntitlementGrant.ts:73–85`

```text
73: export function coversCourses(rows: EntitlementRow[], grantedCourses: string[], now: Date = new Date()): boolean {
74:   if (!grantedCourses.length) return true
75:   const unlocked = new Set<string>()
76:   let full = false
77:   for (const e of rows) {
78:     if (e.expires_at && new Date(e.expires_at) <= now) continue
79:     if (e.access_type === 'full') full = true
80:     if (e.access_type === 'courses' && Array.isArray(e.granted_courses)) {
81:       for (const code of e.granted_courses) unlocked.add(code)
82:     }
83:   }
84:   return full || grantedCourses.every((c) => unlocked.has(c))
85: }
```

`api/_utils/orgEntitlementGrant.ts:99–132`

```text
99: export async function ensureOrgEntitlement(
100:   supabase: SupabaseClient,
101:   learnerId: string,
102:   groupId: string,
103:   grantedCourses: string[],
104:   expiresAt: string,
105:   now: Date = new Date(),
106: ): Promise<GrantOutcome> {
107:   if (!grantedCourses?.length) return { status: 'already' }
108: 
109:   const { data, error: readErr } = await supabase
110:     .from('user_entitlements')
111:     .select('access_type, granted_courses, expires_at')
112:     .eq('learner_id', learnerId)
113: 
114:   // A read we could not do is NOT permission to write a second grant — but it
115:   // is also not permission to leave the learner with none. Treat it as a
116:   // failure and let the caller decide; the reconcile cron will come back.
117:   if (readErr) return { status: 'failed', error: readErr }
118: 
119:   if (coversCourses((data ?? []) as EntitlementRow[], grantedCourses, now)) return { status: 'already' }
120: 
121:   const { error: insErr } = await supabase.from('user_entitlements').insert({
122:     id: orgGrantId(learnerId, groupId),
123:     learner_id: learnerId,
124:     access_type: 'courses',
125:     granted_courses: grantedCourses,
126:     expires_at: expiresAt,
127:   })
128:   // 23505 means a concurrent writer got there first with the same computed id.
129:   // That is success, not failure — the row the learner needs exists.
130:   if (insErr && (insErr as { code?: string }).code === '23505') return { status: 'already' }
131:   if (insErr) return { status: 'failed', error: insErr }
132:   return { status: 'granted' }
```

`api/org/enrol.ts:469–486`

```text
469:       if (healedRace.status === 'failed') {
470:         console.error('[org/enrol] entitlement write failed on race replay for learner', learnerId, healedRace.error)
471:         res.status(500).json({ error: 'Internal server error' })
472:         return
473:       }
474:       res.status(200).json({
475:         success: true,
476:         alreadyEnrolled: true,
477:         orgName: policy.org_display_name,
478:         grantedCourses: policy.granted_courses ?? [],
479:         freeAccessUntil: enrolment.free_access_until,
480:         cancellationNeeded: enrolment.cancellation_state === 'needed',
481:       })
482:       return
483:     }
484: 
485:     // ── Membership, by the same rule as every other join path ──────────────
486:     const tagError = await affiliateToGroupNode(supabase, userId, invite.grants_group_id as string, 'student')
```

`api/cron/org-entitlement-reconcile.ts:91–100`

```text
91:     for (const row of candidates) {
92:       const policy = policyByGroup.get(row.group_id)
93:       const outcome = await ensureOrgEntitlement(
94:         supabase,
95:         row.learner_id,
96:         row.group_id,
97:         policy.granted_courses,
98:         row.free_access_until,
99:         now,
100:       )
```

## FE3-05 — Incomplete enrolment repair: the daily backstop never advances beyond one thousand rows

**Confidence: certain limit; uncertain current affected population.** This is about the morning's new repair job, not the original swallowed write.

1. The estate accumulates more than 1,000 org enrolments.
2. A learner outside the rows returned by the cron's unordered first page has an enrolment but lacks its funded entitlement, e.g. their original request returned the now-honest 500 and they did not retry.
3. The daily cron loads `.limit(1000)` without an offset, cursor, ordering or predicate selecting broken/unexpired rows.
4. With the same query plan and unchanged first page, each run checks the same rows and returns normal totals; the omitted learner is never considered. Expired or already-correct rows still consume that page.

**Loss:** the omitted learner can remain locked out of their funded courses indefinitely unless they retry or somebody repairs them. The promise of an unattended daily backstop fails above its first page; not a claim that there are already 1,001 enrolments.

**What would settle it:** obtain the live enrolment count and compare the cron's returned first page with missing-grant enrolments outside it. The source has no pagination loop. One thousand or fewer rows means the capacity defect is dormant today.

`api/cron/org-entitlement-reconcile.ts:45–46`

```text
45: /** One page is plenty: the whole table is in the low thousands at most. */
46: const PAGE = 1000
```

`api/cron/org-entitlement-reconcile.ts:75–100`

```text
75:     const { data: enrolments } = await supabase
76:       .from('org_enrolments')
77:       .select('id, learner_id, group_id, free_access_until')
78:       .limit(PAGE)
79: 
80:     // Only enrolments whose policy actually grants something can be broken. A
81:     // policy with an empty granted_courses list correctly produces no
82:     // entitlement row, and counting those as failures would be crying wolf
83:     // daily for ever.
84:     const candidates = ((enrolments ?? []) as any[]).filter((e) => {
85:       const p = policyByGroup.get(e.group_id)
86:       return !!p && Array.isArray(p.granted_courses) && p.granted_courses.length > 0
87:     })
88: 
89:     let repaired = 0
90:     let failed = 0
91:     for (const row of candidates) {
92:       const policy = policyByGroup.get(row.group_id)
93:       const outcome = await ensureOrgEntitlement(
94:         supabase,
95:         row.learner_id,
96:         row.group_id,
97:         policy.granted_courses,
98:         row.free_access_until,
99:         now,
100:       )
```

## Coverage, limits and rejected leads

Read all six family routes, access/claim, familyMembership, familyAccess/familyGrace, org enrol/subscription/update-seats/vad, orgEntitlementGrant, orgFreeAccess and the new repair cron. Read the family migration, identity-column guard, and relevant subscription, content, lease and Settings consumers. VAD's outer route scopes before reads; its transitive visibility predicate is carried forward to Area 5 rather than declared fully checked here. Org subscription/update-seats derive the leader's group from authenticated identity; client group_id is only honoured in the explicitly privileged subscription-inspection case.

Child sign-in ownership holds under the recorded schema: the supplied member ID must resolve to a row owned by the caller and flagged as a child. Removed-child sign-in is now explicitly intentional recovery, not a revocation bypass. Removal/leave stamps the membership and frees its seat; effective online family cover then stops, while already-issued offline lease tails are a separate intentional mechanism. Creating children before payment does not itself grant paid cover and is not separately called a defect.

Email matching is lowercased and trimmed on invite/claim, but immediate attachment uses the historical `verified_emails` array and first matching learner, not a fresh ownership lookup. Shared addresses across learners are explicitly described in org/enrol source; that is NOT duplicate auth user_id. I did not establish a new external-attacker email-forgery sequence after the identity-column fixes. The absence of an email-confirmation predicate in claim is not alone proof of exploitation: obtaining a valid session for an unverified address depends on Auth configuration.

Available prior audit records were searched for family, seats, cover and entitlement findings; the five candidates above were not identified there. Missing audit files and absence of issue-tracker access remain the deduplication gap from Area 2.

**EXPLICIT GAPS:** no production rows, triggers, Auth settings, paying family count, cron execution records or actual interrupted learners observed. No endpoints invoked, emails sent, application tests or browser sessions run. The private worktree's Git metadata is read-only: report copies are committed/pushed from `$CS_SCRATCH/tmp/report-git` on the same named branch and same baseline. Original source checkout remains unmodified except these report files.
