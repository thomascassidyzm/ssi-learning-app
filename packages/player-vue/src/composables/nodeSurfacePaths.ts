/**
 * nodeSurfacePaths — THE VIEW's node surface has two mounts (docs/THE-VIEW.md):
 *
 *   - admin (ssi_admin god-view): /admin/groups/:id · /admin/schools/:id ·
 *     /admin/classes/:id — the whole forest.
 *   - member (leader path, inside the /schools shell): /schools/org/:id —
 *     ONE path for groups, schools and classes, because the home endpoint
 *     resolves whichever id it's given, and the server (resolveGroupTreeCaller)
 *     scopes a leader to their own subtree with ancestors trimmed.
 *
 * The shared components (NodeMapRail, NodeChildrenList, NodeHomeView,
 * NodeInsightsView) derive which mount they're on from the current route path,
 * so the same component navigates within its own scope — a leader is never
 * bounced to an /admin URL their role can't open.
 */

export function isMemberNodeSurface(path: string | undefined): boolean {
  return (path || '').startsWith('/schools/org')
}

export function groupHomePath(id: string, member: boolean): string {
  return member ? `/schools/org/${id}` : `/admin/groups/${id}`
}

export function classHomePath(id: string, member: boolean): string {
  return member ? `/schools/org/${id}` : `/admin/classes/${id}`
}

/** A school row opens its NODE home when the node exists (THE MODEL I2). */
export function schoolHomePath(
  nodeId: string | null | undefined,
  schoolId: string,
  member: boolean,
): string {
  if (member) return `/schools/org/${nodeId || schoolId}`
  return nodeId ? `/admin/groups/${nodeId}` : `/admin/schools/${schoolId}`
}

/** "See insights" — THE LENS scoped to this node, same mount as the caller. */
export function nodeInsightsPath(
  node: { id: string; commercial?: { schoolId?: string } | null },
  isClass: boolean,
  member: boolean,
): string {
  if (member) return `/schools/org/${node.id}/insights`
  if (isClass) return `/admin/classes/${node.id}/insights`
  if (node.commercial?.schoolId) return `/admin/schools/${node.commercial.schoolId}/analytics`
  return `/admin/groups/${node.id}/analytics`
}
