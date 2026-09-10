/**
 * The Handbook's source is the .vue files themselves.
 *
 * Tom's ruling, 2026-09-07: "the models built the prose, so at the point of
 * making any change they can update the prose too — this is the same notion
 * of APML for agents, not for compilers."
 *
 * So a capability's description does NOT live in a content directory an agent
 * editing a button would never open. It lives in an HTML comment immediately
 * above the element that IS the capability, and the compiler reads it from
 * there. An agent changing what a button does is already looking at the
 * sentence describing it, which is the only arrangement where keeping the
 * two in step is cheaper than letting them drift.
 *
 *     <!-- HANDBOOK Bring your first teacher in
 *          section: getting-people-in
 *          roles: admin, leader, school_admin
 *          place: node-home
 *          keywords: teacher, invite, staff
 *          What it's for. Getting a colleague into the school with a teacher's
 *          view, without them signing up for anything.
 *          Where it is. Your school's home page, the buttons along the top,
 *          **Invite a person**.
 *          How you do it.
 *          1. Open your school's home page.
 *          2. Tap **Invite a person**.
 *          Worth knowing. The link IS their login.
 *          checked: 3f9a1c2e
 *     -->
 *     <button data-walk="verb-invite-person" @click="toggle('person')">Invite a person</button>
 *
 * There is no markup to learn: labelled lines, four prose headings, numbered
 * steps. The one line an agent does not write by hand is `checked:` — the
 * fingerprint of the element the description is pinned to, stamped by
 * `compile.mjs --reconfirm`.
 */
import { createHash } from 'node:crypto'

/**
 * THE ANCHOR NAMESPACES.
 *
 * An anchored element declares itself a capability. The schools dashboard
 * says so with `data-walk`; the delivery-side intelligence surface says so
 * with `data-intel`. Everything that scans for an anchor — the Handbook
 * parser, the anchor gate, the freshness stamp — takes the list rather than
 * the name, so a third namespace is this one line and nothing else.
 *
 * `data-walk` stays first, and stays the default of every helper here, so no
 * existing call site changes meaning.
 */
export const ANCHOR_ATTRS = ['data-walk', 'data-intel']

const alternation = (attrs) => attrs.map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')

/** `<tag … data-walk="id" …>` — group 1 is the attribute, group 2 the id. */
export const anchorTagRe = (attrs = ANCHOR_ATTRS, flags = 'gs') =>
  new RegExp(`<[a-zA-Z][^>]*\\b(${alternation(attrs)})="([a-z0-9-]+)"[^>]*>`, flags)

/** Just the attribute occurrence — group 1 the attribute, group 2 the id. */
export const anchorAttrRe = (attrs = ANCHOR_ATTRS, flags = 'g') =>
  new RegExp(`\\b(${alternation(attrs)})="([a-z0-9-]+)"`, flags)

export const PROSE_HEADINGS = {
  "What it's for.": 'what',
  'Where it is.': 'where',
  'How you do it.': 'how',
  'Worth knowing.': 'note',
}

const BLOCK_RE = /<!--\s*HANDBOOK\b([\s\S]*?)-->/g

/** Strip the comment's leading indentation so the prose reads as prose. */
function dedent(body) {
  return body.split('\n').map((l) => l.replace(/^\s+/, '').replace(/\s+$/, ''))
}

/**
 * Parse every HANDBOOK block in one .vue source.
 *
 * @returns {{entries: object[], errors: string[]}} entries carry their raw
 * offsets so --reconfirm can rewrite the `checked:` line in place.
 */
export function parseHandbookBlocks(path, src, attrs = ANCHOR_ATTRS) {
  const entries = []
  const errors = []
  for (const m of src.matchAll(BLOCK_RE)) {
    const raw = m[0]
    const start = m.index
    const lines = dedent(m[1])
    const title = (lines.shift() ?? '').trim()
    const at = (msg) => errors.push(`${path}: HANDBOOK "${title || '?'}" — ${msg}`)
    if (!title) { at('the first line must be the entry title, on the same line as HANDBOOK'); continue }

    const entry = {
      title, path, section: '', personas: [], place: '', keywords: [], walk: null, parts: [], attr: null, anchor: null,
      what: '', where: '', how: [], note: '', checked: null,
      blockStart: start, blockEnd: start + raw.length, raw,
      // 1-indexed line of the HANDBOOK comment, so a gate failure can say
      // file:line and land the reader on the sentence rather than the file.
      line: src.slice(0, start).split('\n').length,
    }
    let field = null
    for (const line of lines) {
      if (!line) { continue }
      const label = line.match(/^(section|roles|place|keywords|walk|parts|checked):\s*(.*)$/)
      if (label) {
        const [, key, value] = label
        if (key === 'section') entry.section = value.trim()
        else if (key === 'place') entry.place = value.trim()
        else if (key === 'walk') entry.walk = value.trim() || null
        else if (key === 'checked') entry.checked = value.trim() || null
        else if (key === 'roles') entry.personas = value.split(',').map((s) => s.trim()).filter(Boolean)
        else if (key === 'keywords') entry.keywords = value.split(',').map((s) => s.trim()).filter(Boolean)
        // parts: the anchors that are pieces of THIS capability — a form's
        // own fields, say — rather than capabilities in their own right.
        // They are covered by this description; they do not get one each.
        else if (key === 'parts') entry.parts = value.split(',').map((s) => s.trim()).filter(Boolean)
        field = null
        continue
      }
      const heading = Object.keys(PROSE_HEADINGS).find((h) => line.startsWith(h))
      if (heading) {
        field = PROSE_HEADINGS[heading]
        const rest = line.slice(heading.length).trim()
        if (field === 'how') { if (rest) at('put each step on its own numbered line under "How you do it."') }
        else entry[field] = rest
        continue
      }
      const step = line.match(/^(\d+)\.\s+(.*)$/)
      if (step) {
        if (field !== 'how') { at(`numbered line "${step[2].slice(0, 30)}" is not under "How you do it."`); continue }
        entry.how.push(step[2].trim())
        continue
      }
      // A continued sentence.
      if (field === 'how' && entry.how.length) entry.how[entry.how.length - 1] += ' ' + line
      else if (field && field !== 'how') entry[field] += (entry[field] ? ' ' : '') + line
      else at(`stray line "${line.slice(0, 40)}" — every line belongs to a label or a heading`)
    }

    // ADJACENCY IS THE BINDING: the block describes the next anchored element.
    const after = src.slice(entry.blockEnd)
    const nextBlock = after.search(/<!--\s*HANDBOOK\b/)
    const scope = nextBlock === -1 ? after : after.slice(0, nextBlock)
    const anchorMatch = scope.match(anchorTagRe(attrs, 's'))
    if (!anchorMatch) {
      at(`no ${attrs.join(' or ')} element follows it — a description must sit directly above the thing it describes`)
      continue
    }
    entry.attr = anchorMatch[1]
    entry.anchor = anchorMatch[2]
    entry.tag = anchorMatch[0]
    entry.tagStart = entry.blockEnd + anchorMatch.index
    entries.push(entry)
  }
  return { entries, errors }
}

/**
 * THE PROSE FINGERPRINT — what the reader is being told, hashed.
 *
 * The `checked:` stamp is two parts, `<code>.<prose>`, because a stamp that
 * only records the code lets `--reconfirm` bulk-silence every stale sentence
 * in the tree without a single word changing (job #288 found exactly that
 * hatch). Recording the prose the stamp was made against lets the repair tool
 * tell the two cases apart: the sentence was rewritten, or it was not.
 */
const hash8 = (parts) => createHash('sha256').update(parts.join('\n')).digest('hex').slice(0, 8)

export function proseFingerprint(entry) {
  return hash8([entry.title, entry.what, entry.where, ...entry.how, entry.note ?? ''])
}

/**
 * The prose half of a WALK STEP's stamp — the same idea, over the words a
 * walk step actually says. A step's prose is its `say` line and, on the last
 * step, its `terminal` sign-off; nothing else reaches the learner.
 */
export function stepProseFingerprint(step) {
  return hash8([step.say ?? '', step.terminal ?? ''])
}

/**
 * The code half of a WALK STEP's stamp.
 *
 * A step names an anchor, not a file, and one anchor id can legitimately
 * appear on more than one element — a v-if/v-else pair, or the same
 * capability rendered in two views. So the step's fingerprint is every one of
 * those sites' capability fingerprints, sorted and hashed together: change
 * what ANY of them does and the step is stale, which is the honest reading of
 * "the thing this step points at changed".
 *
 * It inherits fingerprintCapability's limit exactly — one file, no callees —
 * and that limit is the whole guarantee: a step goes stale when the element
 * under it changes in its own .vue, not when an API route behind it does.
 *
 * @param sites [{ src, tag, tagStart }] — every element carrying the anchor.
 */
export function anchorFingerprint(sites) {
  if (!sites?.length) return null
  return hash8(sites.map((s) => fingerprintCapability(s.src, s.tag, s.tagStart)).sort())
}

/** The code half of a `checked:` stamp. Legacy one-part stamps are all code. */
export const checkedCode = (checked) => (checked ? String(checked).split('.')[0] : null)
/** The prose half, or null for a legacy one-part stamp made before this existed. */
export const checkedProse = (checked) => (checked ? String(checked).split('.')[1] ?? null : null)

/**
 * THE FINGERPRINT — what actually changes when a capability's behaviour changes.
 *
 * Three things, and deliberately only three:
 *  1. the anchored element's opening tag, minus its cosmetic attributes — so
 *     the GATE (v-if / v-show), the HANDLER (@click and friends), and the
 *     enabling predicate (:disabled) are all in;
 *  2. the words the user reads on it — its own label text;
 *  3. the source of every handler or predicate named in that tag and declared
 *     in the same file — so changing what the button DOES trips it even when
 *     the template line is untouched.
 *
 * Restyling does not trip it: class, :class and style are dropped, because a
 * guard that fires on a colour change gets routed around, and a guard that is
 * routed around protects nothing.
 *
 * WHAT IT CANNOT SEE, stated plainly because an overstated guarantee is worse
 * than a stated limit: it reads ONE FILE — the .vue the anchor lives in. A
 * handler that calls a composable, an API route, an RPC or a store action
 * carries only the CALL into the fingerprint, never the callee. So rewriting
 * what /api/classes/add-students actually does, or changing the composable
 * behind useClassRoster, does NOT trip this gate, and the description can go
 * quietly wrong. The primary mechanism remains the prose living beside the
 * code; this is a backstop for same-file drift only.
 */
const COSMETIC_ATTRS = /^(class|:class|style|:style)$/

export function fingerprintCapability(src, tag, tagStart) {
  const attrs = [...tag.matchAll(/([@:.\w-]+)="([^"]*)"/g)]
    .filter(([, name]) => !COSMETIC_ATTRS.test(name))
    .map(([, name, value]) => `${name}=${value.replace(/\s+/g, ' ').trim()}`)
    .sort()
  const element = (tag.match(/^<([a-zA-Z][\w-]*)/) ?? [, '?'])[1]

  // The label the user reads, where the element has a short text body.
  const after = src.slice(tagStart + tag.length)
  const close = after.search(new RegExp(`</${element}>`))
  const label = close > -1 && close < 200
    ? after.slice(0, close).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
    : ''

  // Behaviour: the declarations named in the tag's own expressions.
  const expressions = attrs.filter((a) => /^[@:]|^v-(if|show|else-if)/.test(a)).join(' ')
  const names = [...new Set([...expressions.matchAll(/\b([a-zA-Z_$][\w$]*)\s*\(?/g)].map((m) => m[1]))]
  const bodies = []
  for (const name of names) {
    const decl = declarationSource(src, name)
    if (decl) bodies.push(decl)
  }

  return createHash('sha256')
    .update([`<${element}`, ...attrs, `label:${label}`, ...bodies.sort()].join('\n'))
    .digest('hex')
    .slice(0, 8)
}

/**
 * The source of a top-level `function x` / `const x =` declaration, read by
 * BALANCED BRACKETS rather than by looking for a brace in column 0 — a
 * one-line arrow has no such brace, and scanning on to the next one swallows
 * half the file, which makes the fingerprint move when anything else in that
 * file moves. Balanced scanning keeps it to the declaration itself.
 *
 * A declaration this cannot find simply contributes nothing: a slightly
 * weaker fingerprint, never a false failure.
 */
export function declarationSource(src, name) {
  const re = new RegExp(`^[ \\t]*(?:export\\s+)?(?:async\\s+)?(?:function\\s+${name}\\b|(?:const|let|var)\\s+${name}\\s*[:=])`, 'm')
  const m = src.match(re)
  if (!m) return null
  let depth = 0
  let i = m.index
  let started = false
  for (; i < src.length; i++) {
    const c = src[i]
    if ('([{'.includes(c)) { depth++; started = true }
    else if (')]}'.includes(c)) { depth-- }
    else if (c === '\n' && depth <= 0 && started) break
    else if (c === '\n' && !started) break
  }
  return src.slice(m.index, i).replace(/\s+/g, ' ').trim()
}

/** Rewrite a block's `checked:` line, or add one, in the file's text. */
export function stampChecked(src, entry, fingerprint) {
  const block = src.slice(entry.blockStart, entry.blockEnd)
  const indent = (block.match(/\n(\s*)\S/) ?? [, '     '])[1]
  const stamped = /^\s*checked:.*$/m.test(block)
    ? block.replace(/^\s*checked:.*$/m, `${indent}checked: ${fingerprint}`)
    : block.replace(/(\s*)-->\s*$/, `\n${indent}checked: ${fingerprint}\n${indent.slice(0, -5) || ''}-->`)
  return src.slice(0, entry.blockStart) + stamped + src.slice(entry.blockEnd)
}
