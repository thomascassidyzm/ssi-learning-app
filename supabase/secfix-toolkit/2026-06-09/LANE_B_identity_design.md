# Lane B design: the identity bridge — and the real shape of "UUID vs TEXT"

**Date:** 2026-06-10 · evidence measured live (probe `/tmp/ssi-probe/laneB_identity_probe.sql`) + full app write-path trace. Companion to `PHASE_B_BLOCKED_user_tags_class_sessions.md` and `HANDOFF_state_of_nation.md`.

---

## 1. "UUID vs TEXT" is three different problems — only one of them bites

**(a) TYPE inconsistency** (what the CLAUDE.md canonical-pattern table addresses):
- Every `learner_id` column in the DB is **uuid, consistently — 17 tables, zero exceptions**. The learner spine is already clean.
- The TEXT columns are exactly the **auth-uid-bearing** ones (`learners.user_id`, `user_tags.user_id`/`added_by`, `schools.admin_user_id`, `classes.teacher_user_id`, `class_sessions.teacher_user_id`, `govt_admins.user_id`, `*_by` audit columns...), plus three uuid islands (`player_events.user_id`, `try_links.created_by`, `release_notes.created_by`).
- Cost today: the `::text` cast dance in 35 policies. Annoying, survivable.

**(b) VALUE inconsistency — this is what has actually bitten us, repeatedly:**
- `player_events.user_id` is **uuid-typed but stores `learners.id`**, not auth uid (2000/2000 recent rows match learner PK, 0 match auth uid; 13k null = guests). The CLAUDE.md pattern table holds it up as the "UUID → compare `auth.uid()` directly" example — **a policy written from that table would silently match nothing**. The type was right and the meaning was wrong: type normalisation would not have prevented this.
- `class_sessions.teacher_user_id` holds **three generations in one column**: 81 rows = `learner.id` (current `LearningPlayer.vue:644` writes `learnerId.value`), 76 rows = auth uid (an earlier/other writer), 8 rows = `guest-<uuid>` (guests run class mode too). Meanwhile `classes.teacher_user_id` is consistently auth uid (118/121). No single-predicate policy can be correct against this column as-is.
- 23 live policies still use the stale `jwt->>'sub'` idiom that migration `20260512_unify_user_id_auth_pattern` supposedly removed — live/migration drift, again.

**(c) IDENTITY DUALITY** — the root: two identities (`learners.id` = operational PK; `auth.uid()` = login credential) flow into same-shaped columns with no convention for which one a column means. (b) is just (c) leaking.

**Verdict: yes, it's time — but the target is (c), not (a).** Retyping TEXT→uuid first would be churning 35 policies and a dozen columns while leaving both bite-classes alive.

---

## 2. The design: one spine, one bridge

**Spine decision** (matches the data-arch doc's direction):
- **Learner-data tables key on `learner_id uuid = learners.id`** — already true everywhere.
- **Org/auth tables key on auth uid** (`user_tags`, `classes`, `schools`, `govt_admins`) — already true everywhere except the `class_sessions` mess.
- `auth.uid()` appears in exactly ONE mapping: `learners.user_id` (unique-indexed: `learners_user_id_key`).

**The bridge** — one helper ends the per-table bridging problem:

```sql
CREATE OR REPLACE FUNCTION public.current_learner_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS
$$ SELECT id FROM public.learners WHERE user_id = (auth.uid())::text $$;
```

Every own-row policy on learner-data tables becomes `learner_id = current_learner_id()` — no joins repeated per policy, no cast confusion, and **if we ever retype `learners.user_id` to uuid, only this one function changes**. That is what kills the UUID-vs-TEXT trap: not retyping columns, but making the comparison exist in exactly one place.

---

## 3. Staged plan (each stage canary-able, Dublin-safe)

### B0 — free wins, can ship NOW (no app changes, zero behaviour change)
- The five "blocked" tables — `learner_points`, `learner_milestones`, `learner_practice_history`, `response_metrics`, `spike_events` — are **all EMPTY (0 rows ever)**. The blocker doesn't apply to them: nothing writes them in practice (`SessionStore.saveMetrics/saveSpikes` exist but never fire; the other three have no writers at all). RLS-on + own-row policies via `current_learner_id()` (SELECT/INSERT/UPDATE `WITH CHECK learner_id = current_learner_id()`) is future-proof if those paths ever wake, costs nothing today, and closes the anon-write hole.
- `player_events`: only written via `api/player-events.ts` (service-role, cookie-derived id). Lock client writes entirely (RLS on; service-only write; own-row SELECT via `user_id = current_learner_id()` if the app ever reads it; nulls = guests stay service-visible only).
- Correct the CLAUDE.md canonical-pattern table: `player_events.user_id` holds `learners.id` VALUES — add the value-meaning column to the table so the next policy author doesn't get bitten.

### B1 — the two real writer fixes (small app PR + backfill migration)
1. `class_sessions`: change `LearningPlayer.vue:644` to write `userId.value` (auth uid) — aligning with `classes`. Backfill the 81 learner-PK rows via the learners mapping; decide the 8 guest rows (annotate or leave; guests have no auth uid). **Decision needed: should guest class-play write class_sessions at all?**
2. `user_tags` re-point (`useAuth.ts:226-237`): move into `relink_user_tags(old,new)` SECURITY DEFINER fn asserting `new = auth.uid()::text` (blocker doc option A). Then full user_tags enable with the role-forgery-blocking policies from the blocker doc.
- Timing: class mode features in schools demos — land + canary + staging-soak AFTER Dublin (24 Jun) unless needed sooner.

### B2 — own-row RLS on the LIVE learner tables (the actual Phase B)
- `sessions`, `course_enrollments`, `lego_progress`, `seed_progress`, `learners` (+ `learner_emails` read paths): own-row via `current_learner_id()`; teacher/school-admin inherited reads via the tag graph; **this is the schools-onboarding RLS pass** (CLAUDE.md trigger: 2-3 weeks before first paying school) — needs real teacher-JWT canaries.
- Same pass: replace the 23 stale `jwt->>'sub'` policies (live drift) with canonical predicates.
- Guest rows (`guest-<uuid>` in sessions/progress, learner_id uuid-typed... verify guest writes still work under anon INSERT policies, or move guest persistence fully local).

### B3 — OPTIONAL type normalisation (the original "UUID vs TEXT" ask)
- After B0–B2, `auth.uid()::text` lives in: `current_learner_id()` + org-table policies. Retyping `learners.user_id`, `user_tags.user_id`, `classes/class_sessions.teacher_user_id`, `schools.admin_user_id`, `govt_admins.user_id` TEXT→uuid becomes a mechanical `ALTER ... USING ...::uuid` + policy regen, canary-able in one transaction. Worth doing for hygiene; no longer load-bearing. PostgREST clients are unaffected (JSON strings either way). Skip the `*_by` audit columns that hold non-ids (`flagged_by='learner'`).

---

## 4. Decisions for Tom
1. Bless the spine: learner-data ⇒ `learner_id` (learners PK) / org ⇒ auth uid, bridged ONLY via `current_learner_id()`?
2. B0 now (empty tables + player_events lock + CLAUDE.md fix) — any reason to hold?
3. Guests in class mode: should guest class-play write `class_sessions`, and do we care about the 8 historical guest rows?
4. B1 before or after Dublin?
5. B3 (retyping): do at all, or accept "centralised cast in one function" as the end state?
