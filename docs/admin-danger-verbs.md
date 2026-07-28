# ssi_admin danger verbs — audit map + guards

*2026-07-28. The †-marked rows from `docs/walkthrough-engine-scout.md` §2.3–2.6: the internal
admin verbs where a mis-tap has real blast radius. The fix class is inline guard copy +
confirm steps at the point of action — NOT a walkthrough (a tour seen once doesn't protect
the hundredth use). Governing principle: **proportionate friction** — a confirm step only on
genuinely destructive/irreversible verbs; guard copy alone where the verb is bounded or
reversible. Over-guarding is a failure just like under-guarding.*

## The verb map

| # | Verb | Where | Current risk | Guard shipped |
|---|------|-------|--------------|---------------|
| 1 | Change **Platform role** | `AdminUserDetail.vue` role editor | Commits on `@change` of the select — one mis-tap grants or revokes platform-wide `ssi_admin` power, silently, instantly | **Select + Apply.** The select only *stages*; an apply row appears stating the exact change ("Platform role: none → ssi_admin") plus one blast-radius sentence when granting admin. Apply commits, Cancel reverts. |
| 2 | Change **Educational role** | same editor | Same pattern — reassigns real schools-tier authz (god/govt_admin/school_admin/teacher/tutor/student) on select | Same staged Apply row (shared with #1 — one Apply commits both staged fields). |
| 3 | **Create sign-in link** | `AdminUserDetail.vue` | Mints a real magic link that logs whoever clicks it in AS the user. The "treat it like their password" caveat only appeared AFTER minting | **Guard copy moved BEFORE the button** (mint itself is bounded: single-use, ~1h expiry, not sent anywhere by the mint). No confirm step — that would be over-guarding a bounded verb. Post-mint caveat kept. |
| 4 | **Skip to end of trial** | `AdminUserDetail.vue` trial panel | Backdates the user's real trial windows with zero confirm; end-of-trial gates fire on their next load. "QA only" by the authors' own caveat | **Two-tap arm/confirm inline** (button arms → "Confirm — end trial now" + one line naming the effect; Cancel disarms). Reversible via the adjacent Restore, so a modal would be disproportionate. |
| 5 | **Grant access — bulk email allowlist** | `EmailAllowlistForm.vue` | Highest blast radius in the app: one tap grants silent **lifetime full access** to every pasted email, and applies instantly to already-existing accounts — a paste error commits immediately | **Two-phase submit.** First tap opens a review step: the exact parsed count, the full email list as parsed, and "lifetime full access · applies immediately to existing accounts". Commit button reads "Grant to N emails". Editing the paste box resets the review. |
| 6 | **Purge (demo org)** | `DemoOrgsPanel.vue` | Irreversible deletion of the org's group tree, learners and progress — most destructive verb on the surface. Was a native `confirm()`: no impact data, reflex-clickable | **Reuse `ConfirmDeleteModal`** (already used for group deletes in the same panel): real impact counts fetched from `/api/groups/:group_id`, typed-name confirmation **iff** the tree has real recorded activity — the same escalation rule the group delete already uses. |
| 7 | **Save (onboarding message)** | `AdminOnboardingView.vue` | Save = publish: the (future) send system reads this table live, no staging step. The only warning was a banner scrolled off-screen at the moment of save | **Guard copy at the point of action** — one line beside the Save button. No confirm: editing copy is a routine verb; the failure mode is ignorance of the semantics, not a mis-tap. |

## Checked and deliberately NOT guarded

- **Expire now (demo org)** — recoverable via Extend 30d; scout verdict was hint-at-most.
- **Restore trial (+30d)** — restorative by definition.
- **Revoke entitlement** — already carries a native confirm.
- **Magic link for one person** (`EmailAllowlistForm` top form) — one named email typed by
  hand; the form-filling IS the deliberation. Scout marked it walkthrough-grade, not †.
- **Delete group (Demos tree)** — already has the impact-preview + typed-confirm modal.

## Guard-copy register

Blast radius in plain words, computed from real data where cheap (the allowlist count and
the purge impact counts are real; role-change copy is static because the radius is
categorical, not numeric). British English, no hedging, no "are you sure?" without saying
what happens.
