# Area 5 — the admin and teacher hierarchy, view-as, schoolScope

Baseline: this checkout, cut from `origin/dev` (`f666d4a7`). Read-only. No live database was queried; nothing was executed. Every line quoted is from source in this tree.

The school-deletion claim that opened this area is settled in its own file: [area-5-hierarchy-and-school-deletion.md](area-5-hierarchy-and-school-deletion.md) — **FE5-01, confirmed**. This file is the rest of Area 5.

Two findings here are **already known and filed** and are recorded as such, not as new: the view-as guard being advisory, and the input handling in `api/school/class-progress.ts`. They are at the bottom.

---

## FE5-02 — a global role and a per-school membership are joined by "whichever tag is oldest", and it grants class deletion at the wrong school

**Confidence: certain on the mechanism. Likely on live reachability** — it needs one person with tags at two schools, and I have not queried the database. Severity: high where it lands, and this is the read-and-write twin of FE5-01.

### The two halves that do not fit together

**Half one: the role is GLOBAL.** `learners.educational_role` is a single column on the person, with no school attached. Redeeming an invite code overwrites it — `api/code/redeem.ts:376–387`:

```text
376:  const learnerUpdate: Record<string, unknown> = { invite_code_id: inviteRow.id }
377:  if (codeType === 'ssi_admin' || codeType === 'god') {
378:    // 'god' collapsed into 'ssi_admin' (2026-06-16); legacy god codes grant admin.
379:    learnerUpdate.platform_role = 'ssi_admin'
380:  } else if (codeType === 'tester') {
381:    learnerUpdate.platform_role = 'tester'
382:  } else if (codeType === 'school_admin_join') {
383:    learnerUpdate.educational_role = 'school_admin'
384:  } else {
385:    learnerUpdate.educational_role = codeType
386:  }
```

`.update(learnerUpdate).eq('user_id', userId)` at `:388–391`. There is one role slot per person, and the last code redeemed wins it.

**Half two: the membership is PER-SCHOOL, and the resolver picks the oldest one.** `api/_utils/schoolScope.ts:75–85`, the `.order('added_at', { ascending: true }).limit(1)` already quoted in the deletion file:

```text
79:     .eq('user_id', authUid)
80:     .eq('tag_type', 'school')
81:     .is('removed_at', null)
82:     .order('added_at', { ascending: true })
83:     .limit(1)
84:     .maybeSingle()
85:   if (tag?.tag_value) return (tag.tag_value as string).replace('SCHOOL:', '')
```

**Where they are multiplied together.** `api/_utils/schoolScope.ts:286–294`:

```text
286:  if (role === 'teacher') {
287:    classIds = await taughtClassIds(svc, authUid)
288:  } else if (role === 'school_admin') {
289:    const schoolId = await schoolIdForAdmin(svc, authUid)
290:    if (schoolId) {
291:      schoolIds = [schoolId]
292:      classIds = await classIdsForSchools(svc, [schoolId])
293:    }
294:  }
```

What is wrongly trusted: **that the school a caller is `school_admin` OF is the school whose tag is oldest.** Nothing enforces that. The role says *what* they are; the tag says *where*; the two are read from different rows and never checked against each other. `role_in_context` — the column that would settle it, and which `api/school/remove-staff.ts:81` reads correctly — is not consulted here.

### The sequence

1. Alice teaches at school A. She redeems A's teacher invite code. `api/code/redeem.ts:682–689` writes `user_tags(tag_type='school', tag_value='SCHOOL:A', role_in_context='teacher')` at time t1, and `:385` sets `learners.educational_role = 'teacher'`.
2. Later Alice sets up, or is invited to run, school B. She redeems a `school_admin_join` code for B. `api/code/redeem.ts:646–650` writes her `SCHOOL:B` tag with `role_in_context='admin'` at time t2 > t1, and `:383` overwrites `learners.educational_role = 'school_admin'` — globally, with no mention of B.
3. Alice calls any `api/school/*` endpoint with her own ordinary token. `resolveVisibleScopeUncached` reads `role = 'school_admin'` (line 283), takes the `school_admin` branch (line 288), and `schoolIdForAdmin` returns the **oldest** tag: **A**.
4. Her scope is now `schoolIds = [A]` and `classIds =` every active class in **A** (`classIdsForSchools`, `:184–192`).
5. She reads school A whole: `GET /api/school/roster` (`api/school/roster.ts:82`, `:92`), `GET /api/school/daily-activity` (`:52`), `GET /api/school/class-progress` for any class in A (`:431–436`), `class-practice-7d`, `practice-by-course`, `group-summary`, `rate-compare`.
6. **And she writes.** `POST /api/school/delete-class` authorises on nothing but that same set — `api/school/delete-class.ts:66–69`:

```text
66:    const scope = await resolveVisibleScope(supabase, auth.userId)
67:    if (!scope.classIds.includes(classId)) {
68:      res.status(403).json({ error: 'Not your class' })
69:      return
70:    }
```

so she can delete **any class in school A**, including classes she has never taught. `api/school/rename-class.ts:66–67` is the identical check, so she can rename them too.

### What is gained, and what is lost

Gained: full school-admin read over a school where the person is only a teacher — every class, every student's progress, the whole roster and analytics rather than the classes they teach — plus deletion and renaming of any class in it. `deleteClassCascade` takes the class's sessions, its invite codes, its student tags and its class-entity learner row.

Lost, and this half will be noticed first: **school B, the school she actually administers, returns nothing.** Her scope never contains it. That is the same defect wearing its other face, and it is why this is likely to surface as a support ticket ("my dashboard is empty") long before anyone reads it as a security bug.

Scale, honestly: nobody is paying yet, so today this is demo and pilot tenancies. It also needs one specific person — someone tagged at two schools, teacher first. That is not exotic (a teacher who later starts their own school; a contractor teaching at one school and administering another) but it is not the common case either.

### The estate already knows how to do this correctly, in three other places

- `api/_utils/groupTreeAuth.ts:53–58` checks `learners.educational_role === 'school_admin'` before trusting the resolver, with the comment "*a teacher also carries a SCHOOL: tag but stays on the teacher surfaces*".
- `api/school/remove-staff.ts:70–86` resolves the caller's school itself, requiring `schools.admin_user_id` **or** a tag with `role_in_context = 'admin'`.
- `api/_utils/schoolStaff.ts:29–33` states the convention outright: "the founding admin's tag carries `role_in_context='admin'` … There is deliberately NO second convention".

`schoolIdForAdmin` uses none of the three, and its name promises the opposite of what it does.

**What would settle it:** one query — `select user_id, count(*) from user_tags where tag_type='school' and removed_at is null group by user_id having count(*) > 1`, joined to `learners.educational_role`. Any row where the role is `school_admin` and the earliest tag's `role_in_context` is `'teacher'` is a live instance.

---

## FE5-03 — a write on another tenant's rows happens BEFORE the authorisation check, on an id the caller chooses

**Confidence: certain on the write-before-authz ordering. Likely on the consequence below.** Severity: low-to-moderate on its own; it matters because of what the row it creates changes about deletion.

### The ordering

`api/_utils/vadVisibility.ts:347–361`:

```text
347:  if (asGroup.data) {
348:    nodeId = groupId
349:    label = (asGroup.data as { name?: string }).name || 'Group'
350:  } else if (asSchool.data) {
351:    const s = asSchool.data as { school_name?: string; node_group_id?: string | null; is_demo?: boolean; is_test?: boolean }
352:    nodeId = s.node_group_id
353:      || (await ensureSchoolNode(svc, asSchool.data as never, { is_demo: !!s.is_demo, is_test: !!s.is_test }))
354:    label = s.school_name || 'School'
355:  }
356:  if (!nodeId) return { denied: true, status: 404, error: 'Not found' }
357:
358:  const allowed = caller.isAdmin || (await isWithinLeaderSubtree(svc, caller.ownGroupId, nodeId))
359:  if (!allowed) {
360:    return { denied: true, status: 403, error: 'You do not have access to this group' }
361:  }
```

Line 353 **writes**. Line 358 is where permission is decided. The function's own docstring at `:264–267` says "`target.id` is CLIENT INPUT and is treated as such: it is resolved to a real node/class/learner, then checked against the caller's own scope BEFORE any roster is read" — that is true of the *roster*, and the mint slipped in ahead of it.

`ensureSchoolNode` is not a read. `api/_utils/schoolNode.ts:27–46`:

```text
27:  const { data: node, error: nodeErr } = await supabase
28:    .from('groups')
29:    .insert({
30:      name: school.school_name,
31:      type: 'school',
32:      parent_id: school.group_id,
33:      is_demo: flags?.is_demo ?? false,
34:      is_test: flags?.is_test ?? false,
35:      name_confirmed: true,
36:    })
...
43:  const { error: linkErr } = await supabase
44:    .from('schools')
45:    .update({ node_group_id: node.id })
46:    .eq('id', school.id)
```

An INSERT into `groups` and an UPDATE to the `schools` row — under the service-role client, so RLS does not apply.

And the caller here is **anybody signed in**. `resolveVadCaller` deliberately never 403s (`api/_utils/vadVisibility.ts:71–76`: "*Never 403s by itself*"), so a student with an empty scope reaches line 353. `GET /api/admin/vad-prosody` (`api/admin/vad-prosody.ts:69`) and `GET /api/org/vad` are the two doors.

### The sequence

1. Sign in as any learner — a student account is enough. No role, no tags, no scope.
2. Obtain any `schools.id`. School ids travel in URLs and in join-code flows; a tenant's own staff hold dozens; and `computeSchoolImpact` hands them out to anyone the deletion endpoint lets in.
3. `GET /api/admin/vad-prosody?groupId=<that school id>`.
4. `resolveVadCaller` returns a caller with `ownGroupId = null` and an empty scope — not a rejection.
5. The school row is found (line 300). If its `node_group_id` is NULL, line 353 **mints a `groups` row for that school and links it**.
6. Line 358 then evaluates `isWithinLeaderSubtree(svc, null, nodeId)`, which returns false at `api/_utils/orgLeader.ts:22`, and the caller gets a 403.

The 403 is correct and the data stays private. The write has already happened. Repeat with a different school id for each school you can name.

### Why the row matters

Because a school's *own node* is what decides whether it survives its parent group being deleted. `api/_utils/schoolGroupDeletion.ts:127–134`:

```text
127: /**
128:  * Impact preview mirrors deleteGroupCascade EXACTLY (the honest-delete
129:  * ruling, founder pass C 2026-07-19): the whole descendant subtree of
130:  * groups is deleted; a school whose OWN node (`node_group_id`) is in the
131:  * subtree dies with it; legacy-attached schools (group_id in the subtree,
132:  * node elsewhere/none) are ungrouped — they survive and appear at top
133:  * level.
```

`ensureSchoolNode` parents the new node at `school.group_id` (line 32). So a school that was "legacy-attached — survives the parent's deletion, ungrouped" is converted, by an outsider's GET request, into "has its own node inside that subtree — dies with it." The attacker does not delete anything; they change what a later, legitimate deletion destroys.

What is gained: the ability to make an arbitrary school's rows appear and change shape in the group tree, and to move a school from the surviving class to the dying class of a future group deletion. Nothing is read that should not be read.

Scale, honestly: modest. The node is one the model says every school ought to have anyway, `name_confirmed: true` is written for a name nobody confirmed, and the destructive consequence needs someone to delete the parent group afterwards. But it is an unauthenticated-in-effect write to another tenant's rows, and the fix is an ordering, not a design.

**What would settle it:** `select count(*) from schools where node_group_id is null and group_id is not null` — that is the population this can be walked against. If it is zero, the finding is inert today and the ordering is still wrong.

The same ordering appears at `api/groups/[id]/home.ts:147` and `:158`, and at `api/groups/[id]/rate-compare.ts:278` and `:287`, where the mint also precedes `callerCanSeeGroup` (`home.ts:166`). Those are narrower: `resolveGroupTreeCaller` has already 403'd anyone who is not a govt_admin or a school_admin (`api/_utils/groupTreeAuth.ts:95`), so the caller must at least be a leader somewhere. Same defect, smaller door.

---

## Checked and found sound

Recorded so the next reader does not repeat the walk.

- **`isStrictDescendantGroup`** (`api/_utils/schoolScope.ts:145–158`) walks `parent_id`, not the slug `path`, and refuses when either id is absent from the forest. The prefix-match hazard it names in its own comment (`'ime-demo'` swallowing `'ime-demo-two'`; two live tenants sharing the slug `deborah-testing`) is genuinely avoided. `isWithinLeaderSubtree` (`api/_utils/orgLeader.ts:22`) fails closed on a null on either side.
- **`api/school/remove-staff.ts:70–107`** resolves the caller's school from `schools.admin_user_id` or a `role_in_context='admin'` tag, then requires the target to hold an active `teacher` tag on *that* school. Body input is never trusted for the caller's school. This is the pattern `schoolIdForAdmin` should have.
- **`api/admin/*`** — every route except `codes.ts`, `invites.ts`, `update-school.ts` and `vad-prosody.ts` gates on `verifyAdmin` as its first act. `codes.ts:57` and `invites.ts:465` derive `isSsiAdmin` themselves and scope a non-admin to `created_by = <their own uid>`; both use `.single()`, so a duplicate `learners` row yields an error, an undefined `learner`, and `isSsiAdmin === false` — fail-closed. `vad-prosody.ts` is deliberately hierarchy-scoped rather than admin-only (founder ruling, 2026-08-20) and its gate is FE5-03's subject, not its role check.
- **`api/admin/view-as.ts`** — the `end` action is scoped with `.eq('admin_user_id', adminResult.userId)` (`:97`), so an admin cannot close another admin's audit row. `verifyAdmin` gates the whole handler.
- **`resolveVisibleScope`'s 20-second cache** (`api/_utils/schoolScope.ts:257–268`) is keyed on the auth uid alone and holds only the scope, never fetched data. A membership *revocation* is honoured up to 20s late on a warm Vercel instance — worth knowing, not a claim: there is no sequence in which an attacker controls the key or the timing well enough to gain anything they did not have 20 seconds earlier.

---

## Already known and filed — not new

**View-as read-only is advisory, not enforced.** `api/_utils/actAsGuard.ts:25–27` decides on a header the client chooses to send:

```text
25: export function isViewAsRequest(req: VercelRequest): boolean {
26:   return req.headers['x-ssi-view-as'] === '1'
27: }
```

Still true on this baseline, and the repo pins it deliberately: `api/_utils/actAsGuard.advisory.security.test.ts:8–10` records the guard's own honesty about it. The walk, since the brief asked for the walk rather than the label: an ssi_admin browsing as a persona omits the `X-Ssi-View-As` header on one request and the three endpoints carrying a deliberate admin support bypass — `api/teacher/class-teachers.ts:68`, `create-class-join-code.ts:57`, `create-class-learner.ts:56` — perform the write under that bypass while the UI is in a mode that promises read-only. The actor is an ssi_admin, who can perform those same writes outside view-as anyway, so nothing is gained that the actor did not already hold; what is lost is the guarantee the mode advertises, and the audit story that goes with it. A related, smaller point in the same family: the view-as audit record (`api/admin/view-as.ts`, described at `:4–8` as "*the GDPR legitimate-interest compliance record*") is written only if the client chooses to POST it, so the record of impersonation is voluntary for the person it records.

**`api/school/class-progress.ts:224, 254` input handling.** Filed already; the guards are present on this baseline — `safeInteger`/`safeIdToken` at `:239–245` with the reason stated at `:236–238` ("`.or()` is a filter EXPRESSION, so the ratchet bound must be a plain integer"). Recorded here only so it is not re-reported as new.

---

## Limits

- No live database query. FE5-02's reachability and FE5-03's target population are both stated as inferences, with the settling query written out.
- Nothing was executed and no request was made against any deployment; both sequences are derived from source.
- `api/_utils/classTeacherAuth.ts`, `classTeacherTag.ts`, `operatorGuard.ts` and `schoolTeachers.ts` were read only as far as their callers in the paths above, not swept line by line. `api/admin/users.ts`, `board-metrics.ts`, `board-snapshot.ts` and `attention.ts` were confirmed `verifyAdmin`-gated and not read further.
