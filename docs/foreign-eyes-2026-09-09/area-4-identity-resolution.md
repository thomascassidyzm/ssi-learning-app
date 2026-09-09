# Area 4 — identity resolution

Baseline `4555418a`. **No new defect claimed.** The suggested duplicate-row/NULL authority bypass does not survive the source read.

## What maybeSingle actually does

The installed dependency is `@supabase/postgrest-js` **2.86.0**, matching `pnpm-lock.yaml` and the installed supabase-js version. Source was read directly; nothing was executed or downloaded. For GET, `maybeSingle()` requests JSON and marks the builder. More than one returned row produces `PGRST116`, status 406 and `data = null`; exactly one unwraps it; zero yields null. It does not choose the first of multiple rows, and ordinary awaited errors need not throw.

`node_modules/.pnpm/@supabase+postgrest-js@2.86.0/node_modules/@supabase/postgrest-js/src/PostgrestTransformBuilder.ts:219–236`

```text
219:   /**
220:    * Return `data` as a single object instead of an array of objects.
221:    *
222:    * Query result must be zero or one row (e.g. using `.limit(1)`), otherwise
223:    * this returns an error.
224:    */
225:   maybeSingle<
226:     ResultOne = Result extends (infer ResultOne)[] ? ResultOne : never,
227:   >(): PostgrestBuilder<ClientOptions, ResultOne | null> {
228:     // Temporary partial fix for https://github.com/supabase/postgrest-js/issues/361
229:     // Issue persists e.g. for `.insert([...]).select().maybeSingle()`
230:     if (this.method === 'GET') {
231:       this.headers.set('Accept', 'application/json')
232:     } else {
233:       this.headers.set('Accept', 'application/vnd.pgrst.object+json')
234:     }
235:     this.isMaybeSingle = true
236:     return this as unknown as PostgrestBuilder<ClientOptions, ResultOne | null>
```

`node_modules/.pnpm/@supabase+postgrest-js@2.86.0/node_modules/@supabase/postgrest-js/src/PostgrestBuilder.ts:159–176`

```text
159:         if (this.isMaybeSingle && this.method === 'GET' && Array.isArray(data)) {
160:           if (data.length > 1) {
161:             error = {
162:               // https://github.com/PostgREST/postgrest/blob/a867d79c42419af16c18c3fb019eba8df992626f/src/PostgREST/Error.hs#L553
163:               code: 'PGRST116',
164:               details: `Results contain ${data.length} rows, application/vnd.pgrst.object+json requires 1 row`,
165:               hint: null,
166:               message: 'JSON object requested, multiple (or no) rows returned',
167:             }
168:             data = null
169:             count = null
170:             status = 406
171:             statusText = 'Not Acceptable'
172:           } else if (data.length === 1) {
173:             data = data[0]
174:           } else {
175:             data = null
176:           }
```

`api/_utils/familyMembership.ts:32–39`

```text
32: /** Resolve the learners.id for an auth user id. Null if no learner row yet. */
33: export async function resolveLearnerId(
34:   supabase: ServiceClient,
35:   userId: string,
36: ): Promise<string | null> {
37:   const { data } = await supabase.from('learners').select('id').eq('user_id', userId).maybeSingle()
38:   return (data?.id as string | undefined) ?? null
39: }
```

The helper discards the error, so a database/network failure also becomes null. That conflates absence and inability to read, but none of the inspected null branches turns it into another person's identity or a wider query.

## Can two learner rows share the queried identity?

The recorded schema contains `UNIQUE(user_id)` and the learner column is NOT NULL. Multiple accounts for one person or email are a different fact: they need distinct auth user IDs. The new create-child path explicitly upserts on user_id to adopt the auth trigger's row. The named class entity uses `class-learner:<class UUID>`, not a Supabase auth UUID; verified `getUser().id` cannot equal that synthetic value in the normal identity model.

`supabase/schema.sql:13925–13929`

```text
13925: -- Name: learners learners_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
13926: --
13927: 
13928: ALTER TABLE ONLY public.learners
13929:     ADD CONSTRAINT learners_user_id_key UNIQUE (user_id);
```

`api/_utils/classLearnerEntity.ts:35–49`

```text
35:       .from('learners')
36:       .insert({
37:         user_id: `class-learner:${classId}`,
38:         display_name: (cls as any).class_name || 'Class',
39:         is_class_entity: true,
40:       })
41:       .select('id')
42:       .single()
43:     if (learnerErr || !learner) return { error: learnerErr?.message || 'Failed to create class learner' }
44:     learnerId = learner.id as string
45: 
46:     const { error: updateErr } = await svc
47:       .from('classes')
48:       .update({ class_learner_id: learnerId })
49:       .eq('id', classId)
```

`api/family/create-child.ts:90–102`

```text
90:   // THE ROW THE DATABASE HAS ALREADY MADE. `on_auth_user_created` fires on the
91:   // insert above and writes the learners row itself, naming it from the
92:   // display_name in user_metadata. This endpoint used to INSERT a second one
93:   // and hit learners_user_id_key every single time — so no child account had
94:   // ever been created on the live database (zero rows, checked 2026-09-08),
95:   // and every parent who tried saw "Failed to create child account". Upsert
96:   // on user_id adopts the trigger's row, and still creates one wherever the
97:   // trigger is absent.
98:   const { data: childLearner, error: learnerErr } = await supabase
99:     .from('learners')
100:     .upsert({ user_id: childUserId, display_name: displayName }, { onConflict: 'user_id' })
101:     .select('id')
102:     .single()
```

## Every NULL caller

| Caller | NULL outcome | Authority gained? |
| --- | --- | --- |
| `api/access/claim.ts:75` | Skips family attach. Its separate grant learner lookup at 111–119 also returns zero grants. | No |
| `api/family/leave.ts:39` | 404 before membership update | No |
| `api/family/create-child.ts:58` | 404 before auth-user creation | No |
| `api/family/index.ts:47` | 200 with false ownership/plan and empty members | No; a read error can temporarily hide the management view |
| `api/family/signin-link.ts:52` | 404 before member lookup/link mint | No |
| `api/family/invite.ts:63` | 404 before invitation insert | No |
| `api/family/remove.ts:51` | 404 before membership update | No |

The last two are additional callers beyond those listed in the brief. Evidence:

`api/access/claim.ts:73–78`

```text
73:     let familyAttached = 0
74:     try {
75:       const learnerId = await resolveLearnerId(supabase, user.id)
76:       if (learnerId) {
77:         familyAttached = (await attachPendingInvitesForEmail(supabase, learnerId, email)).attached
78:       }
```

`api/access/claim.ts:110–119`

```text
110:   // Find the learner for this auth user.
111:   const { data: learner } = await supabase
112:     .from('learners')
113:     .select('id')
114:     .eq('user_id', userId)
115:     .maybeSingle()
116: 
117:   if (!learner) {
118:     return { granted: 0, items: [] }
119:   }
```

`api/family/leave.ts:39–43`

```text
39:   const learnerId = await resolveLearnerId(supabase, authResult.userId)
40:   if (!learnerId) {
41:     res.status(404).json({ error: 'Learner account not found' })
42:     return
43:   }
```

`api/family/create-child.ts:58–62`

```text
58:   const ownerLearnerId = await resolveLearnerId(supabase, authResult.userId)
59:   if (!ownerLearnerId) {
60:     res.status(404).json({ error: 'Learner account not found' })
61:     return
62:   }
```

`api/family/index.ts:47–51`

```text
47:   const learnerId = await resolveLearnerId(supabase, authResult.userId)
48:   if (!learnerId) {
49:     res.status(200).json({ isOwner: false, hasFamilyPlan: false, seatsUsed: 0, seatCap: FAMILY_SEAT_CAP, members: [], removedChildren: [], familyEndsAt: null, planChangesAt: null })
50:     return
51:   }
```

`api/family/signin-link.ts:52–56`

```text
52:   const ownerLearnerId = await resolveLearnerId(supabase, authResult.userId)
53:   if (!ownerLearnerId) {
54:     res.status(404).json({ error: 'Learner account not found' })
55:     return
56:   }
```

`api/family/invite.ts:63–67`

```text
63:   const ownerLearnerId = await resolveLearnerId(supabase, authResult.userId)
64:   if (!ownerLearnerId) {
65:     res.status(404).json({ error: 'Learner account not found' })
66:     return
67:   }
```

`api/family/remove.ts:51–55`

```text
51:   const ownerLearnerId = await resolveLearnerId(supabase, authResult.userId)
52:   if (!ownerLearnerId) {
53:     res.status(404).json({ error: 'Learner account not found' })
54:     return
55:   }
```

## What authentication has proven

`verifyAuthToken` calls Supabase Auth `getUser()` using the supplied bearer and returns that user's ID only if Auth returns a user without error. This proves the presented session's Auth identity, not family ownership, payment, school scope or a particular verified email. `getAuthUserId` adds no further proof. `verifyAdmin` additionally reads the authenticated learner's roles with the user's own token and requires `ssi_admin` or legacy `god`. The family link route then independently checks owner learner ID and the child flag. `access/claim` uses its own `getUser(token)` and derives the email from the returned user, not the body; it does not itself check an email-confirmed timestamp.

`api/_utils/auth.ts:49–68`

```text
49:   try {
50:     // Create a Supabase client with the user's JWT
51:     const supabase = createClient(supabaseUrl, supabaseAnonKey, {
52:       global: { headers: { Authorization: `Bearer ${token}` } },
53:     })
54: 
55:     const { data: { user }, error } = await supabase.auth.getUser()
56: 
57:     if (error || !user) {
58:       // GoTrue's session_not_found (a revoked session's still-unexpired
59:       // token) surfaces as AuthSessionMissingError, whose message "Auth
60:       // session missing!" reads as gibberish in a UI banner. Say what it
61:       // means and what to do.
62:       const message = error?.name === 'AuthSessionMissingError'
63:         ? 'Your session has ended — sign in again'
64:         : error?.message || 'Invalid token'
65:       return { valid: false, error: message }
66:     }
67: 
68:     return { valid: true, userId: user.id }
```

`api/_utils/auth.ts:78–80`

```text
78: export async function getAuthUserId(req: VercelRequest): Promise<string | null> {
79:   const result = await verifyAuthToken(req)
80:   return result.valid ? result.userId ?? null : null
```

`api/_utils/auth.ts:101–123`

```text
101:     const { data: learner, error } = await supabase
102:       .from('learners')
103:       .select('platform_role, educational_role')
104:       .eq('user_id', authResult.userId)
105:       .single()
106: 
107:     // PGRST116 = no matching row => genuinely not an admin (falls through to
108:     // 403). Any OTHER error (network/RLS/transient) must NOT be read as "not an
109:     // admin" — that would lock a real admin out on a blip. Surface it as 500.
110:     if (error && error.code !== 'PGRST116') {
111:       return { error: 'Admin verification failed', status: 500 }
112:     }
113: 
114:     const isAdmin = learner?.platform_role === 'ssi_admin' ||
115:       learner?.educational_role === 'god'
116: 
117:     if (!isAdmin) {
118:       // The token IS valid — carry the uid so callers with a non-admin door
119:       // (e.g. rate-compare's visible-scope path) don't re-verify it.
120:       return { error: 'Requires SSi admin access', status: 403, userId: authResult.userId }
121:     }
122: 
123:     return { userId: authResult.userId }
```

`api/family/signin-link.ts:58–75`

```text
58:   const { data: membership } = await supabase
59:     .from('family_members')
60:     .select('id, owner_learner_id, member_learner_id, is_child_account, removed_at')
61:     .eq('id', memberId)
62:     .maybeSingle()
63: 
64:   // A REMOVED child row still mints (job #376·F, D7). A child account has no
65:   // email and no way to pay; a parent-minted link is its only door. Refusing a
66:   // removed row made one tap on Remove destroy a child's learning forever.
67:   // Removing someone changes what they can REACH, never what they have DONE.
68:   if (!membership || membership.owner_learner_id !== ownerLearnerId) {
69:     res.status(404).json({ error: 'Member not found' })
70:     return
71:   }
72:   if (!membership.is_child_account) {
73:     res.status(400).json({ error: 'Sign-in links are only for parent-minted child accounts' })
74:     return
75:   }
```

`api/access/claim.ts:57–64`

```text
57:   // Derive the identity from the VERIFIED token, not the body.
58:   const { data: userData, error: userError } = await supabase.auth.getUser(token)
59:   const user = userData?.user
60:   const email = user?.email?.toLowerCase().trim()
61:   if (userError || !user || !email) {
62:     res.status(401).json({ error: 'Unauthorized' })
63:     return
64:   }
```

**Confidence:** certain about the quoted installed-library behaviour and source branches; schema uniqueness is recorded, not live-attested here.

**What would settle the remaining uncertainty:** verify `learners_user_id_key` exists in the live database and the deployed dependency is 2.86.0 (or has the same cardinality behaviour). Check Auth confirmation configuration before treating a valid session as proof of a verified email. No live database or Auth calls were attempted.

Identity relinking (`auth/cascade-user-id`) was also read to identify adjacent authority, but it does not change the cardinality/null conclusion. Its orphan condition needs separate assessment under Areas 5–6. No arbitrary class entity or duplicate user_id exploit is claimed.
