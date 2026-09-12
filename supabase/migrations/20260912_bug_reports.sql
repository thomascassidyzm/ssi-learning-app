-- THE LEARNER POSTBOX: "Report a bug", one way only
-- ==================================================
--
-- A learner who hits a bug taps "Report a bug" inside the player, types what
-- happened, optionally attaches a screenshot, and sends. The app attaches what
-- the learner cannot tell us: the course, the LAST LEGO PLAYED with its own
-- known and target text and the belt, the device, the build, the shell, the
-- deployment, the route, and the last five minutes of player_events. The only
-- reply is the automatic "Got it, thank you." on the learner's screen.
--
-- THIS IS A POSTBOX, NOT A THREAD (Tom's ruling, 2026-09-12): "not have agents
-- reply to them because that would soon escalate ... Reports go to one channel
-- yes and that can be one of the things we direct you agents to have a look
-- at". So there is NO reply path of any kind: no direction column, no
-- in_reply_to, no answered_at, no status, no priority. Nothing here is ever
-- read back to the learner. A poller on watson-1 posts each row once into the
-- ssi-learning-app project channel on the command surface and stamps
-- posted_at; that stamp is its idempotency key.
--
-- WHY NOT support_threads / support_messages: their whole shape is turn-taking,
-- which is the thing Tom is cutting off. WHY NOT tester_feedback: it is gated
-- to testers and carries a status / priority / admin_notes workflow the postbox
-- must not grow. Its column list was the template for the envelope here.
--
-- POSTURE (RLS doctrine rule 7, declared at creation): RLS on, NO policies —
-- service-role only, exactly like support_signals. Every write goes through
-- POST /api/report/bug (which resolves learner identity from the verified
-- bearer); every read is the poller with the service key.
--
-- APPLIED 2026-09-12 by job #327 canary-style through the postgres role (one
-- transaction; a brand-new table with no policies and no grants touches
-- nothing that exists). Do not re-apply.

BEGIN;

CREATE TABLE IF NOT EXISTS public.bug_reports (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- learners.id, the canonical identity (CLAUDE.md "Identity rationalisation").
  -- Null for a guest.
  learner_id      uuid REFERENCES public.learners(id) ON DELETE SET NULL,
  -- The auth uid the bearer resolved to; null for a guest.
  auth_user_id    text,
  -- What the learner typed. Capped at 2000 characters server-side.
  body            text NOT NULL,
  screenshot_url  text,
  course_code     text,
  -- The LAST LEGO PLAYED: { lego_id, known_text, target_text, belt }. Position
  -- is the lego, never a seed number (Tom, 2026-07-06).
  position        jsonb,
  -- { user_agent, platform, viewport, online, standalone }
  device          jsonb,
  -- __BUILD_NUMBER__ and __BUILD_BRANCH__, the pair scanBuildIdentity guards.
  app_version     text,
  -- platform().shell: 'web' | 'webview'.
  app_shell       text,
  -- production | staging | dev, derived server-side like api/player-events.ts.
  deployment_env  text,
  -- The last five minutes of player_events for this learner, pulled server-side
  -- and merged with the client's unflushed buffer: [{event_type, occurred_at, payload}].
  recent_events   jsonb,
  route           text,
  -- Grouping by shape, computed by the poller: course + shell + belt + last
  -- event type before the report. Display only, never a classifier.
  shape_key       text,
  -- Set by the poller once the row has been posted into the channel. Never
  -- posted twice.
  posted_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bug_reports_unposted ON public.bug_reports (created_at) WHERE posted_at IS NULL;
CREATE INDEX IF NOT EXISTS bug_reports_shape_created ON public.bug_reports (shape_key, created_at);

COMMENT ON TABLE public.bug_reports IS
  'The learner postbox: one-way bug reports with diagnostics attached. No reply path by Tom''s ruling of 2026-09-12; posted_at is the poller''s idempotency key.';

ALTER TABLE public.bug_reports ENABLE ROW LEVEL SECURITY;
-- No policies: service-role only. No grants to anon / authenticated.
REVOKE ALL ON public.bug_reports FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
