/**
 * viewAsPages — every page the persona currently being viewed can reach, so
 * "I need to see every damn page" is a list you walk, not a memory test.
 *
 * Derived from the router's OWN records rather than a hand-kept list: a page
 * added to /schools or /org tomorrow appears here with no second edit, and a
 * page deleted disappears. Routes needing a param the viewer cannot fill are
 * dropped rather than guessed at — a link that 404s teaches nothing.
 *
 * This is navigation inside the viewer, not a second way into it. The ONE way
 * in stays the View as picker; the ONE way out stays the banner's Exit.
 */
import type { RouteRecordNormalized, Router } from 'vue-router'
import type { ViewAsPersona } from '@/composables/useUserRole'

export interface ViewAsPage {
  path: string
  title: string
}

/** Routes whose params we can fill: exactly `:id`, standing for the node. */
function fillable(path: string, nodeId: string | null): string | null {
  const params = path.match(/:[A-Za-z]+\??/g) ?? []
  if (params.length === 0) return path
  if (params.length === 1 && params[0].startsWith(':id') && nodeId) {
    return path.replace(/:id\??/, nodeId)
  }
  return null
}

export function viewAsPagesFor(
  routes: RouteRecordNormalized[],
  persona: Pick<ViewAsPersona, 'role'>,
  nodeId: string | null,
): ViewAsPage[] {
  // A learner has no staff surfaces at all — the player and their own library.
  if (persona.role === 'student') {
    return [
      { path: '/', title: 'Learn' },
      { path: '/me', title: 'My library' },
    ]
  }

  const out: ViewAsPage[] = []
  const seen = new Set<string>()
  for (const r of routes) {
    if (!/^\/(schools|org)(\/|$)/.test(r.path)) continue
    if (r.redirect) continue
    if (!r.components || Object.keys(r.components).length === 0) continue
    const path = fillable(r.path, nodeId)
    if (!path || seen.has(path)) continue
    // Setup and upgrade doors are flows, not pages to inspect.
    if (/\/(setup|upgrade|play)$/.test(path)) continue
    seen.add(path)
    out.push({ path, title: (r.meta?.title as string) || path })
  }
  return out.sort((a, b) => a.path.localeCompare(b.path))
}

export function viewAsPages(
  router: Router,
  persona: Pick<ViewAsPersona, 'role'>,
  nodeId: string | null,
): ViewAsPage[] {
  return viewAsPagesFor(router.getRoutes(), persona, nodeId)
}
