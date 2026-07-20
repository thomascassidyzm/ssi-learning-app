# Invites — verification shots (deployed dev build)

Captured 2026-07-17 against `https://ssi-learning-app-git-dev-zenjin.vercel.app/admin/invites`
with a real ssi_admin session (harness: `packages/player-vue/e2e/invites-redesign/`).
Design rationale: [DESIGN.md](./DESIGN.md).

| Shot | What it shows |
|---|---|
| ![org](img/invites-desktop-org.png) | Default mode — invite into the org tree: who × where × limits, unified list below |
| ![direct](img/invites-desktop-direct.png) | Direct access — code / email allowlist / preview link as sub-variants of one form |
| ![demo](img/invites-desktop-demo.png) | Demo preset — still two fields (Nick's flow), existing demos managed on the same page |
| ![list](img/invites-desktop-list.png) | The one list — real and demo, every source, uses/expiry/creator/active in one place |
| ![created](img/invites-desktop-created.png) | Live-minted leader invite (created through the deployed UI, then deactivated) |
| ![mobile-org](img/invites-mobile-org.png) | Mobile — create card stacks, Invites in the bottom nav |
| ![mobile-demo](img/invites-mobile-demo.png) | Mobile — demo preset |

Verified live on the deployment: all three retired routes redirect in
(`/admin/access → ?mode=direct`, `/admin/demos → ?mode=demo`,
`/admin/try-links → ?mode=direct&sub=preview`); a leader invite was minted
through the UI, appeared in the unified list with the right who/where/what,
and was deactivated via the list's toggle. Existing codes were untouched —
the list is a read-side lens over the four existing tables.
