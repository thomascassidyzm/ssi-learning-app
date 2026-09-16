<script setup lang="ts">
/**
 * HandbookView — the map of everything this dashboard can do. Where a
 * capability has a clip, the clip leads and the prose sits folded beneath
 * it; where it has none, the prose is the entry.
 *
 * Not a video and not a list somebody typed. Every entry on this page is
 * compiled from tools/walkthrough/walks/*.json by tools/walkthrough/compile.mjs,
 * which refuses to emit the pack unless each entry still names a live
 * data-walk anchor in the .vue source. Delete the button and the build
 * breaks — the page cannot quietly outlive the product it describes.
 *
 * Founder rulings, 2026-09-07: it is the HANDBOOK, never Training. And it
 * shows EVERY capability in the school, badged by role, not only the
 * reader's own — a teacher seeing what an admin can do is how they know who
 * to ask.
 *
 * GROUPED BY MOMENT, AND NARROW BY DEFAULT (Tom, 2026-09-16: "the whole list
 * is a bit overwhelming"). 109 entries showed a teacher 49 and a school
 * leader 80, and the six topic sections did nothing to make that a shorter
 * read. So the primary grouping is now WHEN you reach for a capability —
 * setting up, every lesson, when something looks wrong — over just the
 * reader's own, and "Read the lot" is what opens the compendium: everybody's
 * capabilities, in the six alphabetical sections, exactly as before. That
 * supersedes the 2026-09-07 reading of "Just what I can do" as never the
 * default: everything is still one tap away, and the tap is now the long way
 * round rather than the short one.
 */
import { ref, computed, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSchoolContext } from '@/composables/schools/useSchoolContext'
import { useI18n } from '@/composables/useI18n'
import { useClassesData } from '@/composables/schools/useClassesData'
import {
  handbookEntries, handbookSections, handbookMoments, searchHandbook, viewerPersona, isMine, badgesFor,
  placeLink, clipsFor, nextThree, stateFromHome,
  type HandbookEntry,
} from '@/walkthrough/handbook'
import { cachedNodeHome } from '@/composables/admin/nodeHomeCache'
import { walkById, deferWalk, type Walk } from '@/walkthrough/useWalkthrough'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const { currentUser } = useSchoolContext()

const persona = computed(() => viewerPersona(
  currentUser.value?.platform_role,
  currentUser.value?.educational_role,
))

const query = ref('')
// THE LOT = everybody's capabilities, in the six sections. Off is the
// default: the reader's own, in three moments.
const theLot = ref(false)
const mineOnly = computed(() => !theLot.value)
const open = ref<Set<string>>(new Set())
// The words under a clip entry, folded by default: "Written out" unfolds them.
const prose = ref<Set<string>>(new Set())

const all = handbookEntries()
const matched = computed(() => searchHandbook(query.value, all))
const visible = computed(() =>
  mineOnly.value ? matched.value.filter((e) => isMine(e, persona.value)) : matched.value)
const sections = computed(() => handbookSections(visible.value))
const moments = computed(() => handbookMoments(visible.value))
// One list, two groupings: moments while the page is narrow, the old six
// alphabetical sections once the reader has asked for the lot.
const groups = computed(() => (theLot.value ? sections.value : moments.value))


// A search that finds something opens what it found — the reader asked.
watch(matched, (list) => {
  if (!query.value.trim()) return
  open.value = new Set(list.map((e) => e.id))
})

function toggle(id: string): void {
  const next = new Set(open.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  open.value = next
}

function toggleProse(id: string): void {
  const next = new Set(prose.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  prose.value = next
}

// "Read the lot" is the compendium door: everybody's capabilities, in the six
// sections, every entry open and every clip entry's words unfolded. Tapping it
// again comes back to the reader's own three moments, closed.
function readTheLot(): void {
  theLot.value = !theLot.value
  const ids = theLot.value ? visible.value.map((e) => e.id) : []
  open.value = new Set(ids)
  prose.value = new Set(ids)
}

// Deep link from a page's Handbook chip: /schools/handbook?entry=<id> opens
// that entry and scrolls to it. Opening prose is not starting a walk, so
// this is nothing like the never-auto-play rule the engine holds itself to.
onMounted(() => {
  const wanted = String(route.query.entry ?? '')
  if (!wanted) return
  const entry = all.find((e) => e.id === wanted || e.section === wanted)
  if (!entry) return
  open.value = new Set([entry.id])
  requestAnimationFrame(() => {
    document.getElementById(`hb-${entry.id}`)?.scrollIntoView({ block: 'center' })
  })
})

// Markdown-lite: **bold** only, escaped first — same rule as the walk card
// and How this works. The prose is compiled repo content, escaped anyway.
function md(text: string): string {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
}

function badges(entry: HandbookEntry): string[] {
  return badgesFor(entry, persona.value)
}

// The node the reader belongs to — their group where they lead one, else
// their school. Decides whether "Take me there" has anywhere to go.
const nodeId = computed(() => currentUser.value?.group_id || currentUser.value?.school_id || '')

function goTo(entry: HandbookEntry): string | null {
  return placeLink(entry, nodeId.value)
}

// YOUR NEXT THREE (job #5). Read off the node-home payload a sibling view
// already fetched — cacheNodeHome holds it for this session — so this is a
// second READER of the state the Last Step banner and the noticing rules use,
// never a second state model. Cold cache, or no signal that applies, and it
// falls back to the top of "Every lesson", which is never empty.
const nextUp = computed(() => {
  const home = nodeId.value ? cachedNodeHome(nodeId.value) : null
  return nextThree(stateFromHome(home), persona.value, all)
})


// THE CLIP LEADS (job #627, 2026-09-14; supersedes the prose-first layout of
// job #302). Tom, on staging: "the handbook still appears to be pointing to
// the prose, rather than the clips." A capability with a clip for the reader
// opens on Show me, with one line of caption; its words fold under "Written
// out". Only where the walk is for the reader's own persona — a walk steps
// real anchors, and a school admin's walk would point a teacher at controls
// they do not have. The walk cannot run on this page, so the tap defers
// every clip that shows the capability and goes to the place the first one
// lives; the page's own Show-me surface claims whichever fits its node and
// runs it on real data. Nothing here ever plays without that tap.
function clipIds(entry: HandbookEntry): string[] {
  return clipsFor(entry, persona.value)
}

function walkFor(entry: HandbookEntry): Walk | null {
  const id = clipIds(entry)[0]
  return id ? walkById(id) : null
}

// A class-page clip needs a class to run on. The list page has none of its
// anchors, so the reader lands on their first class; with no class yet the
// list is where they can make one. Before this the tap parked every teacher
// on /schools/classes with the walk waiting for a page that never came.
// Since job #999 there is ONE class page — the class node home — so a class
// clip is a node-home walk of kind class, and the reader lands on /org/:id.
const { classes, fetchClasses } = useClassesData()
const firstClassId = computed(() => classes.value[0]?.id ?? null)

function isClassWalk(walk: Walk): boolean {
  const place: any = walk.place
  return place.route === 'node-home' && Array.isArray(place.kinds) && place.kinds.includes('class')
}

function showMeTo(entry: HandbookEntry): string | null {
  const walk = walkFor(entry)
  if (!walk) return null
  if (isClassWalk(walk)) return firstClassId.value ? `/org/${firstClassId.value}` : '/schools/classes'
  return placeLink({ ...entry, place: walk.place }, nodeId.value)
}

async function showMe(entry: HandbookEntry): Promise<void> {
  const to = showMeTo(entry)
  if (!to) return
  deferWalk(clipIds(entry))
  await router.push(to)
}

// A Next-three row opens its entry where it lives on the page, rather than
// navigating: the entry may be in any of the three moments, and scrolling to
// the real row keeps one copy of every capability on the page.
function openFromNext(entry: HandbookEntry): void {
  open.value = new Set([...open.value, entry.id])
  requestAnimationFrame(() => {
    document.getElementById(`hb-${entry.id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  })
}

// One line under the clip: the first sentence of what the capability is for.
function caption(entry: HandbookEntry): string {
  const m = entry.what.match(/^.*?[.!?](?=\s|$)/)
  return m ? m[0] : entry.what
}

onMounted(() => {
  const staff = persona.value === 'teacher' || persona.value === 'school_admin'
  if (staff && !classes.value.length && all.some((e) => clipIds(e).some((id) => { const w = walkById(id); return w ? isClassWalk(w) : false }))) {
    void fetchClasses()
  }
})
</script>

<template>
  <main class="handbook-screen">
    <header class="handbook-head">
      <span class="schools-kicker">{{ t('schools.handbookPage.kicker', 'Handbook') }}</span>
      <h1 class="arsenal page-title">{{ t('schools.handbookPage.title', 'Everything this dashboard can do') }}</h1>
      <p class="handbook-lede">{{ t('schools.handbookPage.ledeClips', 'Where you see Show me, tap it and the steps play on your own dashboard. Everything is written out as well. Search it, or read the lot.') }}</p>
    </header>

    <!-- YOUR NEXT THREE, above the fold. Read off the same account state the
         node home's Last Step banner reads, so the page opens on what this
         school actually needs next rather than on a list of 109 things. -->
    <section v-if="!query.trim() && nextUp.length" class="schools-card schools-card-pad handbook-next">
      <h2 class="arsenal section-title">{{ t('schools.handbookPage.nextThree', 'Your next three') }}</h2>
      <ol class="next-list">
        <li v-for="e in nextUp" :key="e.id" class="next-item">
          <button type="button" class="next-link" @click="openFromNext(e)">{{ e.title }}</button>
          <span class="next-caption">{{ caption(e) }}</span>
        </li>
      </ol>
    </section>

    <div class="schools-card schools-card-pad handbook-controls">
      <input
        v-model="query"
        type="search"
        class="handbook-search"
        :placeholder="t('schools.handbookPage.searchPlaceholder', 'Search the handbook')"
        :aria-label="t('schools.handbookPage.searchAriaLabel', 'Search the handbook')"
      />
      <div class="handbook-toggles">
        <span class="handbook-scope">{{ theLot
          ? t('schools.handbookPage.everything', 'Everything')
          : t('schools.handbookPage.justWhatICanDo', 'Just what I can do') }}</span>
        <button type="button" class="btn-ghost" @click="readTheLot">{{ theLot ? t('schools.handbookPage.justMineAgain', 'Just what I can do') : t('schools.handbookPage.readTheLot', 'Read the lot') }}</button>
      </div>
    </div>

    <p v-if="!visible.length" class="handbook-empty">
      {{ t('schools.handbookPage.emptyState', 'Nothing in the handbook matches that yet.') }}
    </p>

    <section v-for="s in groups" :key="s.id" class="schools-card schools-card-pad handbook-section">
      <h2 class="arsenal section-title">{{ s.title }}</h2>
      <p v-if="'blurb' in s" class="section-blurb">{{ s.blurb }}</p>
      <div class="entry-list">
        <article v-for="e in s.entries" :id="`hb-${e.id}`" :key="e.id" class="entry" :class="{ 'is-open': open.has(e.id) }">
          <button type="button" class="entry-head" :aria-expanded="open.has(e.id)" @click="toggle(e.id)">
            <span class="entry-title">{{ e.title }}</span>
            <!-- A capability with a clip says so on the closed row (job #854, Tom 2026-09-15:
                 "the handbook is STILL just a bunch of prose in most cases"). Before this the
                 only sign was a 10px triangle, so 122 rows read as 122 pieces of prose. The
                 chip is a mark, not a second button: opening the row puts the real Show me
                 first, and nothing plays until that tap. -->
            <span v-if="walkFor(e) && showMeTo(e)" class="entry-clip-pill" aria-hidden="true"><span class="entry-clip-dot"></span>{{ t('org.ui.howThisWorks.showMeShort', 'Show me') }}</span>
            <span class="entry-badges">
              <span v-for="b in badges(e)" :key="b" class="status-pill tone-muted">{{ b }}</span>
            </span>
            <span class="entry-chev" aria-hidden="true">{{ open.has(e.id) ? '−' : '+' }}</span>
          </button>
          <div v-if="open.has(e.id)" class="entry-body">
            <template v-if="walkFor(e) && showMeTo(e)">
              <div class="entry-clip">
                <button
                  type="button" class="btn-play entry-showme"
                  :data-walk-offer="walkFor(e)!.id"
                  @click="showMe(e)"
                >{{ t('org.ui.howThisWorks.showMe', 'Show me — {title}').replace('{title}', walkFor(e)!.title) }}</button>
                <!-- eslint-disable-next-line vue/no-v-html — compiled repo prose, escaped in md() -->
                <p class="entry-caption" v-html="md(caption(e))"></p>
              </div>
              <button type="button" class="entry-prose-toggle" :aria-expanded="prose.has(e.id)" @click="toggleProse(e.id)">
                {{ prose.has(e.id) ? t('schools.handbookPage.hideTheWords', 'Hide the words') : t('schools.handbookPage.writtenOut', 'Written out') }}
              </button>
            </template>
            <div v-if="!walkFor(e) || !showMeTo(e) || prose.has(e.id)" class="entry-prose">
              <h3 class="entry-h">{{ t('schools.handbookPage.whatItsFor', "What it's for") }}</h3>
              <!-- eslint-disable-next-line vue/no-v-html — compiled repo prose, escaped in md() -->
              <p class="entry-p" v-html="md(e.what)"></p>
              <h3 class="entry-h">{{ t('schools.handbookPage.whereItIs', 'Where it is') }}</h3>
              <!-- eslint-disable-next-line vue/no-v-html — compiled repo prose, escaped in md() -->
              <p class="entry-p" v-html="md(e.where)"></p>
              <h3 class="entry-h">{{ t('schools.handbookPage.howYouDoIt', 'How you do it') }}</h3>
              <ol class="entry-steps">
                <!-- eslint-disable-next-line vue/no-v-html — compiled repo prose, escaped in md() -->
                <li v-for="(step, i) in e.how" :key="i" v-html="md(step)"></li>
              </ol>
              <template v-if="e.note">
                <h3 class="entry-h">{{ t('schools.handbookPage.worthKnowing', 'Worth knowing') }}</h3>
                <!-- eslint-disable-next-line vue/no-v-html — compiled repo prose, escaped in md() -->
                <p class="entry-p" v-html="md(e.note)"></p>
              </template>
            </div>
            <div v-if="goTo(e)" class="entry-actions">
              <router-link class="entry-goto" :class="walkFor(e) && showMeTo(e) ? 'btn-ghost' : 'btn-play'" :to="goTo(e)!">{{ t('schools.handbookPage.takeMeThere', 'Take me there') }}</router-link>
            </div>
          </div>
        </article>
      </div>
    </section>
  </main>
</template>

<style scoped>
.handbook-screen { display: flex; flex-direction: column; gap: var(--space-4); padding-bottom: var(--space-6); }
.handbook-head { display: flex; flex-direction: column; gap: 4px; }
.schools-kicker {
  font-family: var(--font-mono, 'Spline Sans Mono', monospace);
  font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--schools-red, #DB1E17);
}
.page-title { margin: 0; }
.handbook-lede { margin: 0; color: var(--schools-fg-2, #555); font-size: var(--text-sm); }

.handbook-controls { display: flex; flex-direction: column; gap: var(--space-3); }
.handbook-search {
  width: 100%; padding: 10px 12px; font: inherit;
  border: 1px solid var(--schools-border-strong, rgba(15,18,18,.18)); border-radius: 10px;
  background: var(--schools-card, #fff); color: var(--schools-fg, #0F1212);
}
.handbook-toggles { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-3); }
.handbook-scope { font-size: var(--text-xs); color: var(--schools-fg-3, #8A8078); }
.handbook-next { display: flex; flex-direction: column; gap: var(--space-2); }
.next-list { margin: 0; padding-left: 1.1em; display: flex; flex-direction: column; gap: var(--space-2); }
.next-item { color: var(--schools-fg-2, #555); }
.next-link {
  display: block; background: none; border: none; padding: 0; cursor: pointer; text-align: left;
  font: inherit; font-size: var(--text-sm); font-weight: var(--font-semibold); color: var(--schools-red, #DB1E17);
}
.next-caption { display: block; font-size: var(--text-xs); color: var(--schools-fg-2, #555); line-height: 1.5; }
.section-blurb { margin: -4px 0 0; font-size: var(--text-xs); color: var(--schools-fg-3, #8A8078); }
.handbook-empty { color: var(--schools-fg-2, #555); font-size: var(--text-sm); }
.handbook-section { display: flex; flex-direction: column; gap: var(--space-3); }
.section-title { margin: 0; font-size: var(--text-lg); }
.entry-list { display: flex; flex-direction: column; }
.entry { border-top: 1px solid var(--schools-border, rgba(15,18,18,.10)); }
.entry:first-child { border-top: none; }
.entry-head {
  width: 100%; display: flex; align-items: center; gap: var(--space-3);
  background: none; border: none; cursor: pointer; padding: 12px 0; text-align: left; font: inherit;
}
.entry-title { flex: 1; color: var(--schools-fg, #0F1212); font-size: var(--text-sm); font-weight: var(--font-semibold); }
.entry-badges { display: flex; gap: 6px; flex-wrap: wrap; }
.entry-chev { color: var(--schools-fg-3, #6b6b6b); font-size: var(--text-sm); width: 1em; text-align: center; }
.entry-clip-pill {
  display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0;
  padding: 2px 10px; border-radius: 999px; font-size: var(--text-xs); font-weight: var(--font-semibold);
  color: var(--schools-red, #DB1E17); border: 1px solid var(--schools-red, #DB1E17); background: var(--schools-card, #fff);
}
.entry-clip-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--schools-red, #DB1E17); animation: entry-throb 2.6s ease-in-out infinite; }
@keyframes entry-throb { 0%, 100% { opacity: .35; transform: scale(.85); } 50% { opacity: 1; transform: scale(1); } }
@media (prefers-reduced-motion: reduce) { .entry-clip-dot { animation: none; } }

/* PHONE (390px, 2026-09-09): title and badges sharing one row squeezed the
   title to one word per line. Below 560px the badges drop under the title —
   the same stacking the Ways in ledger takes at the same breakpoint. */
@media (max-width: 559px) {
  .entry-head { flex-wrap: wrap; align-items: baseline; }
  .entry-title { flex: 1 1 100%; }
  .entry-badges { flex: 1 1 auto; }
}
.entry-body { padding: 0 0 var(--space-4); display: flex; flex-direction: column; gap: 4px; max-width: 62ch; }
.entry-h {
  margin: var(--space-3) 0 0; font: inherit; font-size: var(--text-xs);
  color: var(--schools-fg-3, #6b6b6b); text-transform: uppercase; letter-spacing: 0.08em;
}
.entry-p { margin: 0; color: var(--schools-fg-2, #555); font-size: var(--text-sm); line-height: 1.6; }
.entry-p :deep(strong), .entry-steps :deep(strong) { color: var(--schools-fg, #0F1212); font-weight: var(--font-semibold); }
.entry-steps { margin: 0; padding-left: 1.4em; list-style: decimal; color: var(--schools-fg-2, #555); font-size: var(--text-sm); line-height: 1.6; }
.entry-steps li { margin-bottom: 2px; }
.entry-actions { margin-top: var(--space-4); display: flex; flex-wrap: wrap; gap: var(--space-2); align-items: center; }
.entry-goto { text-decoration: none; }
.entry-showme { font: inherit; cursor: pointer; align-self: flex-start; }
.entry-clip { margin-top: var(--space-2); display: flex; flex-direction: column; gap: var(--space-2); }
.entry-caption { margin: 0; color: var(--schools-fg-2, #555); font-size: var(--text-sm); line-height: 1.6; }
.entry-prose-toggle {
  align-self: flex-start; margin-top: var(--space-2); padding: 2px 0; background: none; border: none; cursor: pointer;
  font: inherit; font-size: var(--text-xs); color: var(--schools-fg-3, #8A8078);
  text-decoration: underline; text-underline-offset: 3px; text-decoration-color: rgba(44, 38, 34, 0.25);
}
.entry-prose-toggle:hover { color: var(--schools-fg-2, #555); }
.entry-prose { display: flex; flex-direction: column; gap: 4px; }
</style>
