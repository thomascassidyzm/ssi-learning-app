/**
 * belowTree — nests the node home's BELOW THIS payload into the containment
 * structure it describes (founder ruling 2026-09-07: "should this be actually
 * a little more diagrammatic, something like a tree structure?").
 *
 * The server sends flat arrays keyed by the node each row hangs under
 * (api/groups/[id]/home.ts → tree). Three kinds of row and no others:
 *   NODE   — a group or school, carrying its whole-subtree rollup
 *   CLASS  — a leaf, on the node that holds it, with its teachers named
 *   PERSON — staff in the subtree who teach no class, so an invited teacher
 *            with nothing to teach yet is VISIBLE rather than missing
 * Learners are counts on the nodes, never rows: a 400-pupil school is a
 * number, not a list.
 *
 * Fallback: a payload with no `tree` (a mission's synthetic world, or a
 * server older than this build) still draws — its direct `children` become
 * the first level and any `classes` slice hangs under the root.
 */

export interface BelowClass {
  id: string
  name: string
  teachers: string[]
  studentCount: number
}

export interface BelowPerson {
  user_id: string
  name: string
}

export interface BelowNode {
  id: string
  name: string
  label: string
  isDemo: boolean
  hasSchool: boolean
  /** Whole-subtree learner count (null when the server sent no rollup). */
  learners: number | null
  children: BelowNode[]
  classes: BelowClass[]
  staff: BelowPerson[]
  /**
   * Child groups the payload didn't carry (depth-capped or lens-limited) —
   * drawn as one "N more below" line rather than silently dropped.
   */
  hiddenGroups: number
}

interface FlatNode {
  id: string
  name: string
  label?: string
  is_demo?: boolean
  hasSchool?: boolean
  parentId?: string | null
  rollup?: { childGroupCount?: number; learnerCount?: number } | null
}

/** True when this node holds nothing at all — an empty group LOOKS empty. */
export function isEmptyNode(n: BelowNode): boolean {
  return n.children.length === 0 && n.classes.length === 0 && n.staff.length === 0 && n.hiddenGroups === 0
}

/** Every node in the drawn tree, root first — used for expand-all decisions. */
export function flattenNodes(root: BelowNode): BelowNode[] {
  return [root, ...root.children.flatMap(flattenNodes)]
}

export function buildBelowTree(payload: Record<string, any> | null | undefined): BelowNode | null {
  const node = payload?.node
  if (!node?.id) return null
  const rootId = String(node.id)

  const tree = payload?.tree
  const flat: FlatNode[] = Array.isArray(tree?.nodes)
    ? tree.nodes
    : (payload?.children || []).map((c: any) => ({ ...c, parentId: rootId }))
  const classRows: any[] = Array.isArray(tree?.classes) ? tree.classes : (payload?.classes || [])
  const staffRows: any[] = Array.isArray(tree?.staff) ? tree.staff : []

  const make = (n: FlatNode | any, isRoot: boolean): BelowNode => ({
    id: String(n.id),
    name: n.name,
    label: n.label || 'group',
    isDemo: !!n.is_demo,
    hasSchool: !!n.hasSchool || !!n.commercial,
    learners: typeof n.rollup?.learnerCount === 'number' ? n.rollup.learnerCount : null,
    children: [],
    classes: [],
    staff: [],
    // The root's own hidden count is meaningless — its children are the point.
    hiddenGroups: isRoot ? 0 : Math.max(0, Number(n.rollup?.childGroupCount ?? 0)),
  })

  const root = make(node, true)
  const byId = new Map<string, BelowNode>([[rootId, root]])
  for (const n of flat) {
    if (!n?.id || String(n.id) === rootId) continue
    byId.set(String(n.id), make(n, false))
  }
  // Parent before child: attach in payload order, then anything whose parent
  // never arrived hangs off the root rather than vanishing.
  for (const n of flat) {
    const id = String(n?.id ?? '')
    const self = byId.get(id)
    if (!self || id === rootId) continue
    const parent = byId.get(String(n.parentId ?? '')) || root
    parent.children.push(self)
  }
  // A node whose children are all present has nothing hidden.
  for (const n of byId.values()) n.hiddenGroups = Math.max(0, n.hiddenGroups - n.children.length)

  for (const c of classRows) {
    const holder = byId.get(String(c?.nodeId ?? '')) || root
    holder.classes.push({
      id: String(c.id),
      name: c.name,
      teachers: Array.isArray(c.teachers) ? c.teachers : [],
      studentCount: Number(c.studentCount ?? 0),
    })
  }
  for (const p of staffRows) {
    const holder = byId.get(String(p?.nodeId ?? '')) || root
    holder.staff.push({ user_id: String(p.user_id), name: p.name })
  }

  const sortDeep = (n: BelowNode): void => {
    n.children.sort((a, b) => a.name.localeCompare(b.name))
    n.classes.sort((a, b) => a.name.localeCompare(b.name))
    n.staff.sort((a, b) => a.name.localeCompare(b.name))
    n.children.forEach(sortDeep)
  }
  sortDeep(root)
  return root
}
