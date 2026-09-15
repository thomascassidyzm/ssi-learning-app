# Legacy app billing: read-only ripening scout — the one-page ask

**2026-09-15, job #922. Read-only. No credentials used or created; no live billing system
touched.** Feeds the decision to treat active legacy subscribers as grants in the new app's
ledger (`user_entitlements.source`, job #837·G), reconciled nightly.

This is a NARROWER re-check of `docs/legacy-app-cutover-sizing-2026-09-06.md` (job #737·E,
published https://watson-1.tail4968cb.ts.net/d/0d45ee8d) — read that doc's §2/§THE GAP for
the full rail table and the Apple-IAP binary risk, which is out of scope here. This page adds
one correction to the commission (Recurly exists as a second card rail) and turns the gap
into a forwardable ask.

**Trigger for this page:** today's double-payer ticket (Deborah, Slack `#cyhoeddi`,
2026-09-12/15) — a legacy £12/month subscriber couldn't see premium in the new app, started a
second (Paddle) subscription there, and Deborah cannot find his old payment because it's in
Stripe, not Paddle. Tom's own fix in that thread (16:30, paraphrased): give him the
entitlement now, cross-reference free-access users against Stripe data monthly, revoke if
they've stopped paying in the old app. **That is exactly the nightly-reconciler proposal
this page is ripening — not a new idea, Tom already reasoned his way there in the ticket.**

## 1. What data exists and where

| Rail | Truth lives at | Login holder (evidenced) | Export to accounting evidenced? |
|---|---|---|---|
| **Stripe** (the £12–£15 legacy subs) | Stripe dashboard, behind the legacy backend `automagic.saysomethingin.com` | **Deborah** — she operates the Stripe dashboard directly today (today's thread: *"I thought I'd see both of them in Stripe"*, *"Where is it likely to be if I can't see it in Stripe?"*) | Not evidenced. No Xero/Zoho name found anywhere on the estate (code, docs, env vars) — this is a gap, not a "no", ask Deborah directly. |
| **Recurly** (£3.95 legacy subs) | Recurly dashboard, behind the legacy backend | Not evidenced whose login — Ivan spoke to Recurly state in the Sept sample (*"the £3.95 is active on the DB already"*) but no dashboard-access quote exists | Not evidenced |
| Apple IAP, Google Play, promo grants (Dysgu Cymraeg) | legacy backend + App Store Connect / Play Console | Not evidenced | Not evidenced — out of scope for this page, see #737·E §4 |

**Correction to the commission:** the legacy app has *two* card rails, Stripe and Recurly,
not Stripe alone (job #737·E §2, unchanged since Sept). Today's £12/month ticket is
confirmed Stripe by Deborah's own words above. The September £15/£3.95 split from Ivan's
quote was never reconciled against this £12 figure — three different numbers for what may
be the same or different plans is itself an open question, not a typo to silently resolve.

**Unchanged since the September scout:** this repo's API has zero Stripe/Recurly code
(`grep -ril stripe api/` and `grep -ril recurly api/`, outside test fixtures: 0 hits); the
live `subscriptions` table holds only `provider='paddle'` rows; no env var, migration, or doc
anywhere on the estate names Xero or Zoho. `automagic.saysomethingin.com` answers HTTP 200
unauthenticated and `{"error":true,"reason":"Not Found"}` to an unauthenticated API probe —
reachable, not readable, unchanged from #737·E's finding. Nobody on this estate holds a
credential for it.

## 2. The smallest thing that unblocks — two forwardable asks

**To Deborah** (she already has the Stripe login, this is a five-minute export):

> Could you pull a CSV export from the Stripe dashboard of active subscriptions — Customers
> or Subscriptions export, filtered to `status=active` — with these columns: customer email,
> subscription id, customer id, plan/price, current period end, status? Same again from
> Recurly if you can get to that dashboard. No need to touch anything, just the export. This
> is so we can match legacy payers against the new app automatically instead of finding
> double-payers one support ticket at a time.

**To whoever owns `automagic.saysomethingin.com`** (owner not identified on this estate —
Tom or Deborah to name them):

> We want to stop legacy subscribers hitting a paywall in the new app while they're still
> paying in the old one. Two asks: (1) a read-only API key or export credential — Stripe
> restricted key scoped to read-only Customers + Subscriptions, and the Recurly equivalent —
> so we can run a nightly check rather than a one-off export; (2) confirmation of whether the
> legacy backend already exports subscriber data anywhere (Xero, Zoho, a CSV job, anything) —
> we found no trace of one from our side and don't want to duplicate a pipe that already
> exists.

## 3. What a nightly `stripe_legacy` reconciler would need

Bullet list only — no code drafted, per brief.

- **Key scope.** Stripe *restricted* key, read-only, Customers + Subscriptions objects only.
  Recurly's read-only API-key equivalent. Neither key is created or used by this job.
- **Join key.** Customer email, case-folded, against `learners`/`auth.users`. Confirmed live
  schema: `learners.user_id` holds the Supabase auth uid (text), **not** email — email lives
  on `auth.users.email` and is mirrored into `learners.verified_emails text[]`. The join is
  legacy-CSV-email → `auth.users.email` (or a match against any entry in
  `verified_emails`) → `learners.id` → grant. Aliases/relay addresses are a known soft spot
  (#737·E §3's "email is the account" ruling and its Apple-private-relay tickets) — a
  case-folded exact match first pass, Gmail dot/plus normalisation as an optional second pass
  (taste-safe default, flag for Tom).
- **Grant written.** `user_entitlements` row: `source='stripe_legacy'` (and `'recurly_legacy'`
  for the other rail) — **neither value exists yet** in the `user_entitlements_source_check`
  constraint added by `20260915_individual_grants_ledger.sql` (currently `paddle, play,
  apple, invoice, code, gift, admin, email_allowlist`); a migration adding the two new values
  is a real, small prerequisite. `source_ref` = legacy subscription id. `expires_at` = current
  period end from the CSV/API, plus a grace period — **3 days proposed** (taste-safe default,
  flag for Tom) to absorb a day's reconciler-run lag without a false lapse. Revoke
  (`revoked_at`) when the legacy subscription is no longer active in the source data.
- **Idempotence.** The existing pattern in the same migration (`mirror_paddle_individual_grant`,
  `ON CONFLICT (source, source_ref) ... DO UPDATE`) is the template — same shape, new source
  values, driven by CSV/API read rather than a webhook trigger.
- **Where it runs.** A Vercel cron in this repo is the taste-safe default (matches the
  existing `mirror_paddle_individual_grant` trigger's home) — flagged, not decided here.
- **Fail-open, not fail-closed**, matching #737·E §4's asymmetry argument for Apple IAP: if
  the legacy source can't be read for a cycle, existing grants should not lapse early on
  missing data — only an explicit "no longer active" in the source should revoke.

## 4. Finding today's double-payers — the join, once a CSV lands

```sql
-- scratch table populated from the Stripe/Recurly CSV export in §2, one column: email
-- create temp table legacy_active_emails (email text);
-- \copy legacy_active_emails from 'legacy_active_stripe.csv' csv header;

select
  s.learner_id,
  s.provider_subscription_id as paddle_subscription_id,
  s.status as paddle_status,
  s.current_period_end,
  au.email as new_app_email
from public.subscriptions s
join public.learners l on l.id = s.learner_id
join auth.users au on au.id::text = l.user_id
join legacy_active_emails lae
  on lower(trim(au.email)) = lower(trim(lae.email))
  or lower(trim(lae.email)) = any (select lower(trim(x)) from unnest(l.verified_emails) x)
where s.provider = 'paddle' and s.status = 'active';
```

**On a hit:** refund in Paddle (dashboard action — Deborah needs a Paddle login if she
doesn't already have one; per today's thread, "we don't do refunds in the new app" as a
self-serve flow) and grant the learner via the ledger (§3) so they're not asked to pay twice
going forward. Live count as of the September scout: 19 Paddle subscription rows, 7 active —
small enough to check by hand once a legacy CSV exists, before any reconciler is built.

## Honest gaps

- **No credential for `automagic.saysomethingin.com` exists on this estate** — unchanged
  since #737·E, confirmed again today. Nothing below §2 can proceed without one.
- **No Xero/Zoho export was found anywhere** — absence of evidence, not evidence of absence;
  it's a direct question in the ask above, not a search that can go deeper from here.
- **The £12 / £15 / £3.95 figures were never reconciled** — three numbers, unclear if they're
  the same plan at different times, different plans, or a mix of Stripe and Recurly pricing.
  Flagged rather than guessed.
- **Recurly dashboard access is not evidenced for anyone** — Deborah's access is proven for
  Stripe only.
