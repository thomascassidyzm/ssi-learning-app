/**
 * nodeSurfacePaths — THE VIEW's node surface has two mounts (docs/THE-VIEW.md):
 *
 *   - admin (ssi_admin god-view): /admin/groups/:id · /admin/schools/:id ·
 *     /admin/classes/:id — the whole forest.
 *   - member (leader path, top-level): /org/:id — ONE path for groups, orgs,
 *     schools and classes, because the home endpoint resolves whichever id
 *     it's given, and the server (resolveGroupTreeCaller) scopes a leader to
 *     their own subtree with ancestors trimmed. Top-level since 2026-08-02
 *     (founder ruling: an org/workplace is not a schools feature); the old
 *     /schools/org/:id URLs redirect here. NOTE the singular — /orgs is the
 *     self-serve org SIGNUP door (a distinct route, Onboarding.vue track:
 *     'org'), not a member's own node home, so prefix tests must never
 *     match it.
 *
 * The shared components (NodeMapRail, NodeChildrenList, NodeHomeView,
 * NodeInsightsView) derive which mount they're on from the current route path,
 * so the same component navigates within its own scope — a leader is never
 * bounced to an /admin URL their role can't open.
 */

export function isMemberNodeSurface(path: string | undefined): boolean {
  const p = path || ''
  // Exact-segment test, NOT startsWith('/org') — that would swallow /orgs,
  // the self-serve signup door. The legacy /schools/org/... prefix still
  // counts: the redirect fires on navigation, but a component can render
  // for a tick on the old path.
  return p === '/org' || p.startsWith('/org/') || p.startsWith('/schools/org')
}

export function groupHomePath(id: string, member: boolean): string {
  return member ? `/org/${id}` : `/admin/groups/${id}`
}

export function classHomePath(id: string, member: boolean): string {
  return member ? `/org/${id}` : `/admin/classes/${id}`
}

/** A school row opens its NODE home when the node exists (THE MODEL I2). */
export function schoolHomePath(
  nodeId: string | null | undefined,
  schoolId: string,
  member: boolean,
): string {
  if (member) return `/org/${nodeId || schoolId}`
  return nodeId ? `/admin/groups/${nodeId}` : `/admin/schools/${schoolId}`
}

/** "See insights" — THE LENS scoped to this node, same mount as the caller. */
export function nodeInsightsPath(
  node: { id: string; commercial?: { schoolId?: string } | null },
  isClass: boolean,
  member: boolean,
): string {
  if (member) return `/org/${node.id}/insights`
  if (isClass) return `/admin/classes/${node.id}/insights`
  if (node.commercial?.schoolId) return `/admin/schools/${node.commercial.schoolId}/analytics`
  return `/admin/groups/${node.id}/analytics`
}
