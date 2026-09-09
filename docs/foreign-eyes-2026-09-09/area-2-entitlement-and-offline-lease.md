# Area 2 — entitlement and offline lease

Source baseline: `4555418a`, branch `cs/716-foreign-eyes-sweep-areas-2-7-ent`. Source inspection only; no tests, application execution or live database queries.

## FE2-01 — School/org cover can unlock the UI but still deliver only the free preview

**Confidence: likely.** The disagreement is certain in source; the affected population depends on whether learners also have a separate personal or cascade grant. No paying schools currently, per the commission; trial learners can still encounter it.

1. A learner joins a class in a school with live platform cover, or a class-less org with live platform cover. They have no personal subscription or user entitlement, and no matching `entitlement_grants` cascade row.
2. They ask `/api/entitlement/user`: the class/org coverage helper returns the premium course as entitled.
3. They request that course's bundle with the same valid bearer. `resolveServerCourseAccess` reads personal subscription, personal grants and the cascade RPC only. The RPC reads class-associated explicit grants, not school/org platform cover.
4. The bundle strips everything past the preview boundary. The offline endpoint likewise omits class/org cover, so cannot renew a used-up trial on that cover alone.

**Loss:** a covered learner cannot obtain the premium course beyond Yellow through the content API; offline renewal also disagrees with their displayed entitlement. This is not a claim that the fixed funded org-enrolment path fails: its separate personal grants can mask this discrepancy.

**What would settle it:** inspect one live covered class member with no personal/cascade grant and compare the three access decisions against the quoted source; confirm the deployed cascade definition matches `supabase/schema.sql`. The verifier need not assume all school members are affected.

Evidence:

`api/entitlement/user.ts:99–109`

```text
99:     try {
100:       const classCourses = await resolveClassCourseCoverage(supabase, userId)
101:       if (classCourses.length > 0) {
102:         active.push({
103:           id: 'class-coverage',
104:           access_type: 'courses',
105:           granted_courses: classCourses,
106:           expires_at: null,
107:           redeemed_at: null,
108:           entitlement_code_id: null,
109:         })
```

`api/entitlement/user.ts:122–132`

```text
122:     try {
123:       const orgCourses = await resolveOrgCourseCoverage(supabase, userId)
124:       if (orgCourses.length > 0) {
125:         active.push({
126:           id: 'org-coverage',
127:           access_type: 'courses',
128:           granted_courses: orgCourses,
129:           expires_at: null,
130:           redeemed_at: null,
131:           entitlement_code_id: null,
132:         })
```

`api/_utils/courseAccess.ts:86–124`

```text
86:   if (learner?.id) {
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
107: 
108:     // Cascade entitlements from groups → school → class hierarchy. Mirrors
109:     // api/entitlement/user.ts. Non-fatal: cascade is additive, a failure here
110:     // must not block a learner's own direct subscription/entitlements.
111:     try {
112:       const { data: cascadeCourses } = await supabase.rpc('get_cascade_courses', {
113:         p_user_id: authResult.userId,
114:       })
115:       if (cascadeCourses && cascadeCourses.length > 0) {
116:         entitlements.push({ accessType: 'courses', grantedCourses: cascadeCourses, expiresAt: null })
117:       }
118:     } catch (cascadeErr) {
119:       console.error('[courseAccess] Cascade entitlement lookup failed (non-fatal):', cascadeErr)
120:     }
121:   }
122: 
123:   return checkCourseAccess(courseWithPricing, subscription, entitlements, platformRole)
124: }
```

`supabase/schema.sql:3811–3820`

```text
3811:   FOR rec IN
3812:     SELECT c.id AS class_id, c.school_id, s.group_id
3813:     FROM user_tags ut
3814:     JOIN classes c ON ut.tag_value = 'CLASS:' || c.id::text
3815:     JOIN schools s ON c.school_id = s.id
3816:     WHERE ut.user_id = p_user_id
3817:       AND ut.tag_type = 'class'
3818:       AND ut.role_in_context = 'student'
3819:       AND ut.removed_at IS NULL
3820:   LOOP
```

`supabase/schema.sql:3858–3865`

```text
3858:     SELECT COALESCE(array_agg(DISTINCT course), ARRAY[]::TEXT[])
3859:     INTO level_courses
3860:     FROM entitlement_grants, unnest(granted_courses) AS course
3861:     WHERE entitlement_grants.school_id = rec.school_id
3862:       AND is_active = true
3863:       AND (expires_at IS NULL OR expires_at > NOW());
3864: 
3865:     IF array_length(level_courses, 1) > 0 THEN
```

`api/courses/[code]/bundle.ts:667–688`

```text
667:     const access = await resolveServerCourseAccess(req, supabase, {
668:       course_code: code,
669:       pricing_tier: courseRow.pricing_tier,
670:       is_community: courseRow.is_community,
671:       target_lang: courseRow.target_lang,
672:     })
673:     const previewOnly = !access.canAccess
674:     if (previewOnly && !(access.canPreview && access.previewMaxSeed)) {
675:       res.setHeader('Cache-Control', 'no-store')
676:       res.status(403).json({ error: 'Subscription required', reason: access.reason })
677:       return
678:     }
679:     const previewMaxSeed = access.previewMaxSeed ?? 0
680: 
681:     const scopedLegoRows = previewOnly
682:       ? legoRows.filter((row) => row.seed_number <= previewMaxSeed)
683:       : legoRows
684:     const scopedPhraseRows = previewOnly
685:       ? phraseRows.filter((row) => row.seed_number <= previewMaxSeed)
686:       : phraseRows
687:     const scopedRoundRows = previewOnly
688:       ? roundRows.filter((row) => row.seed_number <= previewMaxSeed)
```

`api/entitlement/offline-lease.ts:176–192`

```text
176:     try {
177:       const { data: cascadeCourses } = await supabase.rpc('get_cascade_courses', {
178:         p_user_id: userId,
179:       })
180:       for (const code of cascadeCourses || []) {
181:         if (!entitledCourseExpiry.has(code)) entitledCourseExpiry.set(code, null) // open-ended
182:       }
183:     } catch (cascadeErr) {
184:       console.error('[offline-lease] Cascade error (non-fatal):', cascadeErr)
185:     }
186: 
187:     const blanket = isPrivileged || subActive || hasFullEntitlement
188:     const isEntitled = (code: string) => blanket || entitledCourseExpiry.has(code)
189:     // The lease-renewal clamp: an open-ended grant (blanket) → no clamp (null);
190:     // a time-boxed course code → its expiry.
191:     const entExpiryFor = (code: string): number | null =>
192:       blanket ? null : (entitledCourseExpiry.get(code) ?? null)
```

## FE2-02 — A short full-access grant receives a longer offline lease than an equivalent course grant

**Confidence: uncertain as a defect; certain as code behaviour.** A 30-day paid offline tail is explicitly intended. Whether the same tail is intended for *time-limited full entitlement codes* needs a policy decision; the code explicitly clamps time-limited course grants, but discards a full grant's deadline.

1. An admin issues a time-limited full-access code, e.g. one day, and a learner redeems it.
2. Just before expiry, the learner reports a downloaded premium course to the offline endpoint.
3. The entitlement passes its current expiry check, sets `hasFullEntitlement`, and becomes blanket access. `entExpiryFor` returns null.
4. The endpoint writes a lease ending 30 days from now. After the original grant expires, the non-payer branch preserves that lease; an ordinary renewal does not revoke it.

**Gain:** up to almost 30 extra days of offline playback after the advertised full-access grant ends. By contrast, an otherwise identical course-scoped grant is clamped to its expiry. This is bounded, not perpetual renewal, and does not unlock new online content after expiry.

**What would settle it:** establish whether the intended contract for a time-limited *full code* includes a 30-day tail. If yes, reject this candidate as intended; if no, the quoted branch is sufficient to confirm it. No live expiry/revocation state was inspected.

`api/entitlement/offline-lease.ts:156–172`

```text
156:     const { data: entitlements } = await supabase
157:       .from('user_entitlements')
158:       .select('access_type, granted_courses, expires_at')
159:       .eq('learner_id', learner.id)
160: 
161:     for (const e of entitlements || []) {
162:       const expMs = e.expires_at ? new Date(e.expires_at).getTime() : null
163:       if (expMs != null && expMs <= serverNow) continue // expired
164:       if (e.access_type === 'full') {
165:         hasFullEntitlement = true
166:       } else if (e.access_type === 'courses' && Array.isArray(e.granted_courses)) {
167:         for (const code of e.granted_courses) {
168:           // Keep the LATEST (max) expiry if a course is granted more than once.
169:           const prev = entitledCourseExpiry.get(code)
170:           if (!entitledCourseExpiry.has(code)) entitledCourseExpiry.set(code, expMs)
171:           else if (prev != null && (expMs == null || expMs > prev)) entitledCourseExpiry.set(code, expMs)
172:         }
```

`api/entitlement/offline-lease.ts:187–192`

```text
187:     const blanket = isPrivileged || subActive || hasFullEntitlement
188:     const isEntitled = (code: string) => blanket || entitledCourseExpiry.has(code)
189:     // The lease-renewal clamp: an open-ended grant (blanket) → no clamp (null);
190:     // a time-boxed course code → its expiry.
191:     const entExpiryFor = (code: string): number | null =>
192:       blanket ? null : (entitledCourseExpiry.get(code) ?? null)
```

`api/entitlement/offline-lease.ts:226–241`

```text
226:         if (isEntitled(code)) {
227:           // Payer → RENEW: slide +30d, clamped to a time-boxed code; mark non-trial.
228:           const clamp = entExpiryFor(code)
229:           const newExpiry = clamp != null ? Math.min(serverNow + LEASE_MS, clamp) : serverNow + LEASE_MS
230:           upserts.push({
231:             learner_id: learner.id,
232:             course_code: code,
233:             granted_at: new Date(prior ? Math.min(serverNow, prior.expiresAt || serverNow) : serverNow).toISOString(),
234:             expires_at: new Date(newExpiry).toISOString(),
235:             last_validated_at: new Date(serverNow).toISOString(),
236:             is_trial: false,
237:             subscription_id: subscription?.id ?? null,
238:             revoked_at: null,
239:             updated_at: new Date(serverNow).toISOString(),
240:           })
241:           courses.push({ courseCode: code, entitlementExpiresAt: clamp, leaseExpiresAt: newExpiry, isTrial: false, revoked: false })
```

`api/entitlement/offline-lease.ts:245–258`

```text
245:         // Non-payer.
246:         if (prior) {
247:           // A taste (or a lapsed paid lease) already exists — do NOT slide. Honour
248:           // the recorded expiry; this is the TRIAL-USED memory (re-download won't
249:           // mint a fresh taste). Touch last_validated_at only.
250:           upserts.push({
251:             learner_id: learner.id,
252:             course_code: code,
253:             expires_at: new Date(prior.expiresAt).toISOString(),
254:             last_validated_at: new Date(serverNow).toISOString(),
255:             is_trial: prior.isTrial,
256:             updated_at: new Date(serverNow).toISOString(),
257:           })
258:           courses.push({ courseCode: code, entitlementExpiresAt: null, leaseExpiresAt: prior.expiresAt, isTrial: prior.isTrial, revoked: false })
```

`packages/player-vue/src/composables/useOfflineLease.ts:200–210`

```text
200:     for (const { courseCode, lease } of leases) {
201:       const a = authority.get(courseCode)
202:       if (a && a.leaseExpiresAt != null) {
203:         // Stateful authority — the server's word is final.
204:         await setOfflineLease(courseCode, userId, {
205:           ...lease,
206:           expiresAt: a.leaseExpiresAt,
207:           lastValidatedAt: serverNow,
208:           revoked: !!a.revoked,
209:           isTrial: !!a.isTrial,
210:           subscriptionId: result.subscriptionId,
```

## Coverage and exclusions

Read all six entitlement routes, `entitlementGrant`, `courseAccess`, `audioAccess`, `trialPolicy`, `me/subscription`, `subscription/index`, and supporting family subscription, class/org coverage, platform status, client lease and schema paths. Followed the bundle gate and cascade implementation. Admin-only mint/list/grant gates derive roles from the authenticated learner; no arbitrary learner selector found there. Direct entitlement expiry is checked on both content and lease paths. Cascade SQL filters inactive/expired grants. Offline leases are database records, not signed bearer credentials; a supplied course list is not itself online access. One free non-renewing taste is intentional. Explicit `revoked_at` wins in the successful stateful path, while ordinary entitlement expiry preserves an existing paid tail by design.

Already known, not new: audio fail-open posture is INPUT-01 residual (08-25 remediation notes; 09-01 area D); unsigned local leases are ADMIN-ENT-11 (08-25 reconciliation). A transient table failure drops revocation information in the stateless fallback; no attacker-controlled trigger established, so not promoted to a separate finding.

**EXPLICIT GAPS:** no live database, production configuration or deployed behaviour checked. The named 08-29 audit directory and adversarial-review-2026-08-31 document were not found in this checkout; the 08-22 audit is archived. Deduplication used available 08-18, archived 08-22, 08-25, 09-01 and 09-05 records, not a live issue tracker. Absence from those records is not proof a claim has never been filed elsewhere.
