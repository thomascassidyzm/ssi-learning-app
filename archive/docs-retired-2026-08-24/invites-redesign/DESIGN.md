# Invites — one primitive, one surface

*2026-07-17 rethink (founder critique: "we do NOT need three different ways to set up access and
groups and demo schools"). Replaces the creation/list halves of /admin/access, /admin/demos and
/admin/try-links with one surface at /admin/invites.*

## The finding that shaped the design

The redemption layer was **already unified**: every code — school teacher/admin join codes, class
student codes, org invites, tester/admin codes — lives in (or is registered into) `invite_codes`
and redeems through `/api/code/redeem`; entitlement codes and email grants have their own tables
but the same lifecycle shape (code/email × access × limits × uses × active). The duplication was
entirely in the **creation and listing layer**: three admin pages, four separate lists, five
creation endpoints, no single view of "every outstanding way into the platform".

So the unified INVITE primitive — **WHO** (role) × **WHERE** (node in the org tree) × **WHAT**
(real vs demo, entitlement) × **LIMITS** (expiry, max uses) — is implemented as **one surface and
one aggregation over the existing tables, not a new table**.

## Better × Simpler × Cheaper

- **Better** — one place to create every way in and one live list of every outstanding
  invite/code across the estate (who created it, uses, expiry, revoke). The demo flow becomes a
  two-field preset of the same primitive and now also mints the govt-admin invite in the same
  step. Nothing a live school holds breaks: every existing code keeps its string, its table and
  its redemption path, untouched.
- **Simpler** — deletes two admin pages and a third list (Try Links) plus their three parallel
  creation forms; adds zero tables, zero dual-writes, zero migration of live bearer credentials.
  One new read/toggle endpoint (`/api/admin/invites`) on the same admin-gated idiom as the rest.
- **Cheaper** — no data migration risk on bearer codes, no RLS surface change (all reads stay
  server-mediated), creation keeps delegating to the existing tested endpoints; the build is a
  view-layer consolidation.

The rejected alternative — a new `invites` table with legacy codes migrated in — fails Simpler
and Cheaper outright (dual-write window, bearer-credential migration risk) for zero
learner-visible gain. The primitive is real, but it is a *lens* over existing storage.

## Pressure-testing the frame

WHO × WHERE × WHAT × LIMITS holds for every existing artefact, with one addition the frame
missed: **DELIVERY**. Most invites are links; the email allowlist is the same grant delivered by
email-match at sign-in instead of by link. It is presented exactly so — a delivery variant on the
direct-access form, not a separate concept.

One capability is deliberately *presented* at a fixed WHERE: learner invites. Real-org learner
joins belong to teachers (class join codes on the teacher dashboard) — leaf-only, unchanged. The
admin surface offers learner links only on demo-tree nodes (the hidden-leaf mechanism,
`api/_utils/demoLeaf.ts`), same as before.

## The surface — /admin/invites

**Create card** with three entry modes (the WHERE-kind decides the flow):

1. **Into an organisation** — pick WHO (group leader / school admin / teacher / school-admin
   join / learner-on-demo-node), pick the node from the org tree, set limits → link.
   - Group leader (govt_admin) → `/api/invite/create` with `grants_group_id`
   - School admin (new school under a group) → `/api/invite/create` (`school_admin`, metadata)
   - Teacher / school-admin-join at an existing school → **surfaces the school's standing join
     links** (no new code minted — reuse, not duplication)
   - Learner at a demo node → `/api/admin/demo-leaf` (hidden-leaf join code)
2. **Direct access (no organisation)** — sub-variants: access **code**
   (`/api/entitlement/create`), **email allowlist** (`/api/access/grant-emails`, delivery by
   email-match, with the existing magic-link mint preserved), **preview link**
   (`/api/try-link/create`, guest, no account).
3. **New demo org** — Nick's preset, still two fields (prospect name + course) →
   `/api/admin/demo-schools` create, **plus a govt-admin invite bound to the new root group in
   the same step** (expiry matched to the org's). Demo org lifecycle (tree grow, extend, expire,
   purge) lives on the same panel; `discoverDemoOrgGraph` already sweeps group-bound govt_admins
   on expire, so the new invite's redeemers are banned with the rest.

**One list** below the create card: every outstanding invite across `invite_codes`,
`entitlement_codes`, `email_access_grants`, `try_links` — columns Who / Where (node path, demo
badge) / What / Link / Uses / Expires / Created-by / Active-toggle, filterable.

## API — /api/admin/invites

- `GET` → `{ invites: UnifiedInvite[] }` aggregated from the four tables, with WHERE resolved to
  names/paths (class → school → group), demo flag from `groups.is_demo` / `schools.is_demo`,
  creator display names joined from `learners`. Scoping mirrors `/api/admin/codes`: ssi_admin
  sees all; other callers see only invite codes they created.
- `POST { source, id, is_active }` → activate/deactivate, routed to the owning table (same
  semantics as the old per-table toggles; non-admins only their own invite codes).

```ts
interface UnifiedInvite {
  source: 'invite' | 'entitlement' | 'email_grant' | 'try_link'
  id: string
  code: string | null              // null for email grants
  urlPath: string | null           // '/redeem/CODE' | '/with/CODE' (student) | '/try/CODE'
  who: 'learner' | 'teacher' | 'school_admin' | 'govt_admin' | 'tester' | 'ssi_admin' | 'guest' | 'access'
  where: { kind: 'platform' | 'group' | 'school' | 'class'; id: string | null;
           name: string | null; path: string | null; isDemo: boolean }
  what: string                     // human summary: 'Real account' | 'Demo' | 'Full access · lifetime' | …
  email: string | null             // email grants only
  limits: { expiresAt: string | null; maxUses: number | null; useCount: number }
  isActive: boolean
  redeemedAt: string | null
  createdBy: string
  createdByName: string | null
  createdAt: string
}
```

## What merged, what stayed separate

**Merged into /admin/invites:** Access Codes (all three of its modes), Demos (as the preset +
lifecycle panel), Try Links (as the guest/preview variant), and the four lists into one.
Old routes `/admin/access`, `/admin/demos`, `/admin/try-links` (+ older aliases) redirect in;
old bookmarks keep working; every existing code keeps redeeming.

**Deliberately separate — Setup keeps STRUCTURE:** the org tree itself (groups/schools CRUD),
direct staff-account creation, and node-attached entitlement *grants* (`entitlement_grants` —
attached access, not a way in; no link, nothing to redeem). Setup's per-school code cells stay as
in-context copies of the same standing codes (same rows, no parallel creation path) and link
into the unified list. If direct staff creation later wants to fold in, it is the same primitive
with DELIVERY = create-account-now; parked, not designed around.
