-- ORG ENROLMENT: a funded cohort, one sign-up link, and a reporting baseline
-- =========================================================================
--
-- Built for the National Centre for Learning Welsh / Dysgu Cymraeg cohort
-- (Kai's spec, 2026-09-08), but deliberately NOT named after it. Everything
-- Canolfan-specific — the org's name, the consent wording, the length of the
-- free year, how long before it ends we warn, which course codes count as the
-- same dialect family — is a ROW in org_enrolment_policies, not a constant in
-- code. A second funder is a row, not a build.
--
-- WHY A TABLE RATHER THAN learners.preferences (the 2026-09-08 scout's
-- suggestion). Four of these fields are not preferences:
--
--   * data_sharing_consent is a compliance artefact. It needs a timestamp, a
--     version of the wording that was consented to, and it must be impossible
--     to hold an enrolment without it. A CHECK constraint says that once; a
--     jsonb key says it nowhere.
--   * reporting_from is the minutes-from-zero baseline. Kai's ruling is a
--     clean break: this cohort's reporting starts at enrolment and pre-cutover
--     history is NOT imported. Nothing is deleted to achieve that — the
--     playback ledger keeps every row it ever had, and the old totals stay
--     retrievable by simply asking for a window that starts earlier. The
--     break lives in this one date column, in the query, and nowhere else.
--   * UNIQUE (group_id, learner_id) makes a duplicate enrolment impossible by
--     construction rather than by an application check that can be raced.
--     The enrolment endpoint is idempotent BECAUSE of this constraint.
--   * free_access_until is read by the expiry-warning cron and by the funder
--     export. A jsonb key would need a functional index for either.
--
-- A MINUTE IS play_seconds. Nothing in this file measures anything, but the
-- export that reads it takes its minutes from learner_speaking_opportunities
-- (the founder ruling of 2026-08-19, made app-wide by 20260908c/d) — never
-- from sessions.duration_seconds, which is wall clock on any row whose
-- accumulator never closed.
--
-- POSTURE (RLS doctrine rule 7): both tables get an explicit posture here, at
-- creation. RLS on, own-row SELECT for the learner so they can see their own
-- free-year end date, and NOTHING else — every write and every org-scoped read
-- goes through a server endpoint that does its own hierarchy authz. No clever
-- policies (doctrine rule 1).

BEGIN;

-- ── The per-org policy: what the enrolment step says and offers ─────────────

CREATE TABLE IF NOT EXISTS public.org_enrolment_policies (
  group_id           uuid PRIMARY KEY REFERENCES public.groups(id) ON DELETE CASCADE,
  org_display_name   text NOT NULL,
  -- The consent sentence shown beside the tick, verbatim. Stored rather than
  -- coded so the wording a learner agreed to can be reproduced exactly, and so
  -- consent_version below can be bumped when it changes.
  consent_statement  text NOT NULL,
  consent_version    text NOT NULL DEFAULT 'v1',
  -- Whether to ask the age question at all, and what it says. A TICK, never a
  -- date of birth (Kai's ruling): holding a birth date to answer a yes/no
  -- question is personal data we do not need.
  ask_age_band       boolean NOT NULL DEFAULT true,
  age_band_label     text NOT NULL DEFAULT 'I am aged 16 to 24',
  free_months        integer NOT NULL DEFAULT 12,
  -- "A few weeks before their free year ends, not on the day."
  warn_days_before   integer NOT NULL DEFAULT 21,
  -- course_code -> family key. A learner who has done both Southern and
  -- Northern Welsh counts ONCE, at whichever family total is higher, never
  -- summed. Every code that should count must appear here; the export reports
  -- any unmapped code it saw rather than silently dropping it.
  course_family_map  jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- The courses the free period actually unlocks. Written into a per-learner
  -- user_entitlements row at enrolment, so each person's year runs from THEIR
  -- own enrolment date rather than from one org-wide clock.
  granted_courses    text[] NOT NULL DEFAULT ARRAY[]::text[],
  is_active          boolean NOT NULL DEFAULT true,
  -- HOW LONG THE SIGN-UP LINK LIVES, as data.
  --
  -- Kai, 2026-09-08: the Canolfan may want the link live all year, or may want
  -- a refreshed one each year, and which of those has NOT been decided. So
  -- neither is compiled in. NULL means the link never expires; a timestamp is
  -- honoured by the enrolment endpoint; and rotating to a fresh link each year
  -- is a call to the setup endpoint with rotateLink, which retires the old code
  -- and mints a new one against the same org. All three are the same table.
  link_expires_at    timestamp with time zone,
  created_at         timestamp with time zone NOT NULL DEFAULT now(),
  updated_at         timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT org_enrolment_policies_free_months_check CHECK (free_months BETWEEN 1 AND 60),
  CONSTRAINT org_enrolment_policies_warn_days_check CHECK (warn_days_before BETWEEN 1 AND 180)
);

COMMENT ON TABLE public.org_enrolment_policies IS
  'One row per org that has an enrolment step. Carries the consent wording, the free-period length, the warning lead time and the course-family map used by the funder export. A second funder is a row here, not a build.';

-- ── The enrolment itself: one row per learner per org ──────────────────────

CREATE TABLE IF NOT EXISTS public.org_enrolments (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id               uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  learner_id             uuid NOT NULL REFERENCES public.learners(id) ON DELETE CASCADE,
  enrolled_at            timestamp with time zone NOT NULL DEFAULT now(),
  -- THE CLEAN BREAK. Minutes for this cohort are counted from this UTC date
  -- forward. Earlier ledger rows are untouched and remain readable.
  reporting_from         date NOT NULL DEFAULT ((now() AT TIME ZONE 'UTC')::date),
  -- The tick, and when it was ticked. The stamp is what lets a 24-year-old
  -- who ticked in 2026 be aged out of the band in 2028 if the funder ever
  -- asks; without it the 16-24 count drifts upward every year.
  age_band_16_24         boolean NOT NULL DEFAULT false,
  age_ticked_at          timestamp with time zone,
  -- No tick, no free access. The CHECK makes an unconsented enrolment
  -- unrepresentable rather than merely unwritten.
  data_sharing_consent   boolean NOT NULL,
  consent_at             timestamp with time zone NOT NULL DEFAULT now(),
  consent_version        text NOT NULL DEFAULT 'v1',
  free_access_until      timestamp with time zone NOT NULL,
  -- What they held at the moment of enrolment, so the "you will need to
  -- cancel this" conversation has a fact behind it. NOTHING in this schema or
  -- in any code that reads it cancels anything.
  prior_subscription_status text,
  prior_subscription_id  uuid REFERENCES public.subscriptions(id) ON DELETE SET NULL,
  cancellation_state     text NOT NULL DEFAULT 'not_needed',
  cancellation_noted_at  timestamp with time zone,
  cancellation_noted_by  text,
  expiry_warned_at       timestamp with time zone,
  invite_code_id         uuid REFERENCES public.invite_codes(id) ON DELETE SET NULL,
  created_at             timestamp with time zone NOT NULL DEFAULT now(),
  updated_at             timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT org_enrolments_consent_required CHECK (data_sharing_consent = true),
  CONSTRAINT org_enrolments_unique_member UNIQUE (group_id, learner_id),
  CONSTRAINT org_enrolments_cancellation_state_check CHECK (
    cancellation_state = ANY (ARRAY['not_needed','needed','learner_confirmed','verified_cancelled'])
  ),
  CONSTRAINT org_enrolments_age_stamp_check CHECK (
    (age_band_16_24 = false) OR (age_ticked_at IS NOT NULL)
  )
);

COMMENT ON TABLE public.org_enrolments IS
  'One row per learner per funded org cohort. UNIQUE (group_id, learner_id) is what makes the enrolment endpoint idempotent — a double submit, a back-button replay or a refresh mid-flow lands on the existing row rather than creating a second one.';
COMMENT ON COLUMN public.org_enrolments.reporting_from IS
  'The minutes-from-zero baseline: the funder export counts learner_speaking_opportunities.day >= this date and no earlier. Pre-cutover history is not deleted, merely out of window.';
COMMENT ON COLUMN public.org_enrolments.cancellation_state IS
  'not_needed = held no paying subscription at enrolment. needed = they did, and were told to cancel it. learner_confirmed / verified_cancelled = a HUMAN recorded that it happened. No code path in this repo cancels a subscription; these values are a record, never a trigger.';

CREATE INDEX IF NOT EXISTS idx_org_enrolments_group ON public.org_enrolments (group_id);
CREATE INDEX IF NOT EXISTS idx_org_enrolments_learner ON public.org_enrolments (learner_id);
-- Drives the expiry-warning cron: "due to be warned, not yet warned".
CREATE INDEX IF NOT EXISTS idx_org_enrolments_warning_due
  ON public.org_enrolments (free_access_until)
  WHERE expiry_warned_at IS NULL;

-- ── Posture ────────────────────────────────────────────────────────────────
--
-- Deny by default; the learner may read their OWN enrolment (the app shows
-- them their free-year end date) and nothing more. Every write, and every
-- org-scoped read, is server-mediated with its own authz — the deliberate
-- alternative to RLS's silent-fail (RLS doctrine rule 1).

ALTER TABLE public.org_enrolments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_enrolment_policies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_enrolments_select_own ON public.org_enrolments;
CREATE POLICY org_enrolments_select_own ON public.org_enrolments
  FOR SELECT TO authenticated
  USING (learner_id IN (SELECT id FROM public.learners WHERE user_id = auth.uid()::text));

-- No policy at all on org_enrolment_policies for authenticated: the enrolment
-- page reads it through the server endpoint, which already knows which code
-- the visitor holds. RLS on + zero policies = deny by default.

REVOKE ALL ON TABLE public.org_enrolments FROM anon;
REVOKE ALL ON TABLE public.org_enrolment_policies FROM anon, authenticated;
GRANT SELECT ON TABLE public.org_enrolments TO authenticated;
GRANT ALL ON TABLE public.org_enrolments TO service_role;
GRANT ALL ON TABLE public.org_enrolment_policies TO service_role;

-- ── The export's arithmetic, where the rows are ────────────────────────────
--
-- THE FAILURE THIS EXISTS TO PREVENT, in Kai's own words about the old system:
-- the cohort size cap was raised, and then "data fetches started timing out
-- (and still do)" once groups got large. That is what happens when a whole
-- cohort's activity is dragged into application memory a page at a time.
--
-- The numbers. A learner practising four days a week for a year leaves roughly
-- 200 rows a year in learner_speaking_opportunities per course. A 10,000-strong
-- cohort is therefore ~2,000,000 rows for an all-time window — 2,000 round
-- trips at PostgREST's 1,000-row page, which will time out long before it
-- finishes, and hold a couple of hundred megabytes if it does not.
--
-- These two functions move the expensive dimension — DAYS — into the database,
-- where it is one index scan and a GROUP BY. What comes back is one row per
-- learner (the roster) and one row per learner per course (the seconds), so a
-- 10,000-learner cohort returns ~10,000 and ~20,000 rows instead of two
-- million. That is a hundredfold reduction and it does not grow with the
-- length of the reporting window.
--
-- What deliberately does NOT move into SQL: the higher-of-dialects rule and
-- the thresholds. Those stay in one tested TypeScript module, because a rule
-- implemented twice is a rule that drifts, and the cheap dimension — at most a
-- handful of courses per learner — costs nothing to fold in the application.

-- One row per PERSON, however many cohorts of this org they hold.
--
-- reporting_from is derived from enrolled_at, so min(reporting_from) is the
-- earliest enrolment's baseline — the same "earliest registration wins" rule
-- the application applies, expressed once more compactly. bool_or on the age
-- band: a person is in the band or is not, and a later untick is not evidence
-- they aged out mid-year.
CREATE OR REPLACE FUNCTION public.org_enrolment_roster(p_group_ids uuid[])
RETURNS TABLE(learner_id uuid, enrolled_on date, reporting_from date, age_band_16_24 boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT e.learner_id,
         min(e.enrolled_at AT TIME ZONE 'UTC')::date AS enrolled_on,
         min(e.reporting_from)                       AS reporting_from,
         bool_or(e.age_band_16_24)                   AS age_band_16_24
  FROM org_enrolments e
  WHERE e.group_id = ANY(p_group_ids)
  GROUP BY e.learner_id;
$$;

COMMENT ON FUNCTION public.org_enrolment_roster(uuid[]) IS
  'One row per person on an org''s roster, deduped across its cohorts at the earliest enrolment. Drives the funder export''s registered count, including learners who have never played.';

-- Seconds per learner per course inside a window, with each learner's own
-- clean-break baseline applied here rather than in the application.
--
-- The GREATEST() is the clean break: a ledger day earlier than that learner's
-- own reporting_from is out of window even if it falls inside the month asked
-- for. Nothing is deleted to achieve it — an older total is still retrievable
-- by an admin querying the ledger directly.
CREATE OR REPLACE FUNCTION public.org_enrolment_window_seconds(
  p_group_ids uuid[],
  p_from date,
  p_to date
)
RETURNS TABLE(learner_id uuid, course_code text, seconds bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH roster AS (
    SELECT e.learner_id, min(e.reporting_from) AS reporting_from
    FROM org_enrolments e
    WHERE e.group_id = ANY(p_group_ids)
    GROUP BY e.learner_id
  )
  SELECT lso.learner_id,
         lso.course_code,
         sum(lso.play_seconds)::bigint AS seconds
  FROM learner_speaking_opportunities lso
  JOIN roster r ON r.learner_id = lso.learner_id
  WHERE lso.day >= GREATEST(p_from, r.reporting_from)
    AND lso.day <= p_to
  GROUP BY lso.learner_id, lso.course_code;
$$;

COMMENT ON FUNCTION public.org_enrolment_window_seconds(uuid[], date, date) IS
  'Playback seconds per learner per course inside a window, with each learner''s own minutes-from-zero baseline applied. Exists so a large cohort''s export is one aggregate rather than millions of rows dragged into application memory — the exact failure the old system hit once its groups grew.';

-- Both are SECURITY DEFINER because they read across learners; both are
-- therefore service_role only, and the funder-export endpoint does its own
-- hierarchy authz before calling either (RLS doctrine rule 1).
REVOKE ALL ON FUNCTION public.org_enrolment_roster(uuid[]) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.org_enrolment_roster(uuid[]) TO service_role;
REVOKE ALL ON FUNCTION public.org_enrolment_window_seconds(uuid[], date, date) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.org_enrolment_window_seconds(uuid[], date, date) TO service_role;

-- The index the aggregate above walks. learner_speaking_opportunities is keyed
-- (learner_id, course_code, day); this adds the day-leading order the window
-- filter wants when a cohort is large enough for the planner to prefer it.
CREATE INDEX IF NOT EXISTS idx_lso_day_learner
  ON public.learner_speaking_opportunities (day, learner_id);

COMMIT;

NOTIFY pgrst, 'reload schema';
