/**
 * evaluateRules — the RUNTIME half of the self-explaining dashboard
 * (docs/self-explaining-dashboard.md §5). Evaluates the explanation pack's
 * declarative noticing rules against the /api/groups/:id/home payload the
 * page has ALREADY fetched — zero new queries, zero model calls, zero
 * polling. Output is gentle invitations (never missions): a sentence and a
 * deep link, rendered dismissible by NoticingInvitations.vue.
 *
 * The compiler (tools/explainer/compile.mjs) validates every rule's paths
 * against home.ts and every CTA target against the list this file resolves —
 * a lockstep the compile fails on if either side drifts.
 */
import { groupHomePath, nodeInsightsPath, schoolHomePath } from '@/composables/nodeSurfacePaths'

export interface RuleCondition {
  path: string
  op: 'eq' | 'gt' | 'lt' | 'gte' | 'lte' | 'truthy' | 'falsy'
  value?: unknown
}

export interface NoticingRule {
  id: string
  shape: 'node' | 'perChild' | 'countWhere'
  kinds: string[]
  personas: string[]
  when?: RuleCondition[]
  arrayPath?: string
  itemWhen?: RuleCondition[]
  min?: number
  invitation: string
  cta: { label: string; target: string }
}

export interface Invitation {
  key: string // rule id + child discriminator — the dismissal key
  ruleId: string
  text: string
  ctaLabel: string
  to: string
  /** Set when the CTA launches a walkthrough ('walk:<id>' target) instead of navigating. */
  walk?: string
}

function get(obj: unknown, path: string): unknown {
  let cur: any = obj
  for (const seg of path.split('.')) {
    if (cur == null) return undefined
    cur = cur[seg]
  }
  return cur
}

function holds(cond: RuleCondition, scope: unknown): boolean {
  const v = get(scope, cond.path)
  switch (cond.op) {
    case 'eq': return v === cond.value
    case 'gt': return typeof v === 'number' && v > (cond.value as number)
    case 'lt': return typeof v === 'number' && v < (cond.value as number)
    case 'gte': return typeof v === 'number' && v >= (cond.value as number)
    case 'lte': return typeof v === 'number' && v <= (cond.value as number)
    case 'truthy': return !!v
    case 'falsy': return !v
    default: return false
  }
}

const allHold = (conds: RuleCondition[] | undefined, scope: unknown): boolean =>
  (conds ?? []).every((c) => holds(c, scope))

/** `{path.to.field}` interpolation from the match scope; `{count}` is special. */
function interpolate(template: string, scope: unknown, count?: number): string {
  return template.replace(/\{([\w.]+)\}/g, (_, p) => {
    if (p === 'count' && count !== undefined) return String(count)
    const v = get(scope, p)
    return v == null ? '' : String(v)
  })
}

/**
 * The node kind for rule/explanation scoping: the payload's own kind
 * ('class'); else the node's OWN label decides — a school attachment never
 * outvotes the label (label-not-type, THE-MODEL §2.1; same founder-reported
 * wart as the IME programme kicker reading "School", 2026-07-20). Only an
 * unlabelled node falls back to what its attachments suggest.
 */
export function nodeKindOf(home: any): string {
  if (home?.kind === 'class') return 'class'
  const n = home?.node
  if (n?.label) return n.label === 'school' ? 'school' : 'group'
  return n?.commercial || n?.hasSchool ? 'school' : 'group'
}

/** Semantic CTA target → concrete path, member/admin-correct. */
function resolveTarget(target: string, home: any, member: boolean, child?: any): string | null {
  const node = home?.node
  if (!node) return null
  switch (target) {
    case 'insights':
      return nodeInsightsPath(node, home.kind === 'class', member)
    case 'lens:classes':
      return `${groupHomePath(node.id, member)}?lens=classes`
    case 'child-home':
      return child ? (child.hasSchool ? schoolHomePath(child.id, child.id, member) : groupHomePath(child.id, member)) : null
    case 'students':
      return null // the students ARE this page's children list — no navigation
    default:
      return null
  }
}

const MAX_PER_RULE = 3

export function evaluateRules(
  rules: NoticingRule[],
  home: unknown,
  persona: string,
  member: boolean,
): Invitation[] {
  const out: Invitation[] = []
  const kind = nodeKindOf(home)
  for (const rule of rules) {
    if (!rule.personas.includes(persona) || !rule.kinds.includes(kind)) continue
    if (!allHold(rule.when, home)) continue
    // 'walk:<id>' CTAs launch an in-place walkthrough instead of navigating
    // (the walkthrough compiler checks the id names a real walk — lockstep).
    const walkId = rule.cta.target.startsWith('walk:') ? rule.cta.target.slice(5) : undefined
    if (rule.shape === 'node') {
      const to = walkId ? null : resolveTarget(rule.cta.target, home, member)
      out.push({
        key: rule.id,
        ruleId: rule.id,
        text: interpolate(rule.invitation, home),
        ctaLabel: interpolate(rule.cta.label, home),
        to: to ?? '',
        ...(walkId ? { walk: walkId } : {}),
      })
    } else {
      const items = get(home, rule.arrayPath || '')
      if (!Array.isArray(items)) continue
      const matches = items.filter((item) => allHold(rule.itemWhen, item))
      if (rule.shape === 'countWhere') {
        if (matches.length >= (rule.min ?? 1)) {
          out.push({
            key: rule.id,
            ruleId: rule.id,
            text: interpolate(rule.invitation, home, matches.length),
            ctaLabel: interpolate(rule.cta.label, home, matches.length),
            to: walkId ? '' : resolveTarget(rule.cta.target, home, member) ?? '',
            ...(walkId ? { walk: walkId } : {}),
          })
        }
      } else {
        for (const item of matches.slice(0, MAX_PER_RULE)) {
          out.push({
            key: `${rule.id}:${item.id ?? item.name ?? ''}`,
            ruleId: rule.id,
            text: interpolate(rule.invitation, item),
            ctaLabel: interpolate(rule.cta.label, item),
            to: walkId ? '' : resolveTarget(rule.cta.target, home, member, item) ?? '',
            ...(walkId ? { walk: walkId } : {}),
          })
        }
      }
    }
  }
  return out
}
