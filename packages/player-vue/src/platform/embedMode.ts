/**
 * embedMode — one answer to "are we the framed marketing demo?".
 *
 * `/embed/*` is the app's one deliberately frameable surface (see the
 * `/embed/(.*)` header rule in vercel.json). It runs inside an iframe on a
 * saysomethingin.com landing page, where the whole point is that it is
 * STATELESS: no service worker to install on somebody's marketing visit, no
 * sign-in, no bundle download, no storage written on an origin the visitor
 * never chose to hold anything for. Playing it twice gives the same thing
 * twice.
 *
 * Read from `location.pathname` rather than the router, because the callers
 * that matter most — App.vue's setup body and main.js — both run before the
 * first route resolves, and they are exactly the ones whose side effects we
 * need to suppress.
 */

export const EMBED_PATH_PREFIX = '/embed/'

/** Does this path name the framed demo surface? */
export function isEmbedPath(pathname: string | null | undefined): boolean {
  return typeof pathname === 'string' && pathname.startsWith(EMBED_PATH_PREFIX)
}

/** Is THIS page load the framed demo? Safe with no window (tests / SSR). */
export function isEmbedContext(): boolean {
  if (typeof location === 'undefined') return false
  return isEmbedPath(location.pathname)
}
