/**
 * useNoticingInvitations — the noticing surface's state, lifted out of
 * NoticingInvitations.vue so ONE evaluation feeds both renderers: the
 * on-page invitation cards AND the How-this-works panel/throb (founder
 * ruling 2026-07-29: How-this-works surfaces ANY of the invitations).
 *
 * Behaviour is unchanged from the original component: pack rules evaluated
 * over the home payload the page ALREADY fetched (zero new queries),
 * dismissible 14 days per rule × node via localStorage, max 3 at once.
 */
import { ref, computed, type Ref } from 'vue'
import pack from '@/explainer/pack.json'
import { evaluateRules, type NoticingRule, type Invitation } from '@/explainer/evaluateRules'

const DISMISS_KEY = 'ssi-noticing-dismissed'
const DISMISS_DAYS = 14

function readDismissed(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(DISMISS_KEY) || '{}')
  } catch {
    return {}
  }
}

export function useNoticingInvitations(opts: {
  home: Ref<unknown>
  persona: Ref<'admin' | 'leader'>
  member: Ref<boolean>
  nodeId: Ref<string>
  /** The dressing kind the surface renders in ('org' under neutral vocabulary). */
  kind?: Ref<string>
}) {
  const dismissed = ref(readDismissed())

  function dismiss(key: string): void {
    const map = readDismissed()
    map[`${opts.nodeId.value}:${key}`] = Date.now()
    // Prune expired entries while we're here so the map never grows unbounded.
    const cutoff = Date.now() - DISMISS_DAYS * 86400000
    for (const k of Object.keys(map)) if (map[k] < cutoff) delete map[k]
    try {
      localStorage.setItem(DISMISS_KEY, JSON.stringify(map))
    } catch {
      /* storage unavailable */
    }
    dismissed.value = map
  }

  const invitations = computed<Invitation[]>(() => {
    if (!opts.home.value) return []
    const all = evaluateRules(
      pack.rules as NoticingRule[],
      opts.home.value,
      opts.persona.value,
      opts.member.value,
      opts.kind?.value,
    )
    const cutoff = Date.now() - DISMISS_DAYS * 86400000
    return all
      .filter((inv) => !(dismissed.value[`${opts.nodeId.value}:${inv.key}`] > cutoff))
      .slice(0, 3)
  })

  return { invitations, dismiss }
}
