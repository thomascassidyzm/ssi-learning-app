<script setup lang="ts">
/**
 * AdminReleaseNotes — /admin/release-notes
 *
 * Curate the "What's new" entries shown in Settings. One row per release
 * (typically aligned with main-merges). Drafts are admin-only; toggling
 * is_published flips visibility for everyone.
 *
 * Bullets are plain strings — one headline per line. No markdown by design
 * (keeps headlines honest and rendering predictable).
 */
import { computed, inject, onMounted, ref, type Ref } from 'vue'

interface ReleaseNote {
  id: string
  version: string
  released_at: string
  headline: string | null
  bullets: string[]
  is_published: boolean
  created_at: string
  updated_at: string
}

const supabase = inject<Ref<any>>('supabase')

const notes = ref<ReleaseNote[]>([])
const isLoading = ref(false)
const error = ref<string | null>(null)
const flash = ref<string | null>(null)

// Form state — also used for the inline edit row (editingId !== null).
const editingId = ref<string | null>(null)
const formVersion = ref('')
const formReleasedAt = ref('')  // YYYY-MM-DD
const formHeadline = ref('')
const formBulletsText = ref('') // one bullet per line
const formPublished = ref(false)
const isSaving = ref(false)

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function resetForm() {
  editingId.value = null
  formVersion.value = todayIso()
  formReleasedAt.value = todayIso()
  formHeadline.value = ''
  formBulletsText.value = ''
  formPublished.value = false
}

function loadIntoForm(n: ReleaseNote) {
  editingId.value = n.id
  formVersion.value = n.version
  formReleasedAt.value = n.released_at.slice(0, 10)
  formHeadline.value = n.headline ?? ''
  formBulletsText.value = n.bullets.join('\n')
  formPublished.value = n.is_published
}

function parseBullets(): string[] {
  return formBulletsText.value
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean)
}

async function fetchNotes() {
  if (!supabase?.value) return
  isLoading.value = true
  error.value = null
  try {
    const { data, error: e } = await supabase.value
      .from('release_notes')
      .select('id, version, released_at, headline, bullets, is_published, created_at, updated_at')
      .order('released_at', { ascending: false })
    if (e) throw e
    notes.value = (data || []) as ReleaseNote[]
  } catch (err: any) {
    error.value = err?.message || 'Failed to load release notes'
  } finally {
    isLoading.value = false
  }
}

async function save() {
  if (!supabase?.value) return
  const bullets = parseBullets()
  if (!formVersion.value.trim()) {
    error.value = 'Version is required'
    return
  }
  if (bullets.length === 0) {
    error.value = 'At least one bullet is required'
    return
  }
  isSaving.value = true
  error.value = null
  try {
    const payload = {
      version: formVersion.value.trim(),
      released_at: new Date(formReleasedAt.value || todayIso()).toISOString(),
      headline: formHeadline.value.trim() || null,
      bullets,
      is_published: formPublished.value,
    }
    if (editingId.value) {
      const { error: e } = await supabase.value
        .from('release_notes')
        .update(payload)
        .eq('id', editingId.value)
      if (e) throw e
      flash.value = 'Saved'
    } else {
      const { error: e } = await supabase.value
        .from('release_notes')
        .insert(payload)
      if (e) throw e
      flash.value = 'Created'
    }
    resetForm()
    await fetchNotes()
    setTimeout(() => { flash.value = null }, 2400)
  } catch (err: any) {
    error.value = err?.message || 'Save failed'
  } finally {
    isSaving.value = false
  }
}

async function togglePublished(n: ReleaseNote) {
  if (!supabase?.value) return
  try {
    const { error: e } = await supabase.value
      .from('release_notes')
      .update({ is_published: !n.is_published })
      .eq('id', n.id)
    if (e) throw e
    await fetchNotes()
  } catch (err: any) {
    error.value = err?.message || 'Update failed'
  }
}

async function remove(n: ReleaseNote) {
  if (!supabase?.value) return
  if (!confirm(`Delete release "${n.version}"? This cannot be undone.`)) return
  try {
    const { error: e } = await supabase.value
      .from('release_notes')
      .delete()
      .eq('id', n.id)
    if (e) throw e
    if (editingId.value === n.id) resetForm()
    await fetchNotes()
  } catch (err: any) {
    error.value = err?.message || 'Delete failed'
  }
}

const formTitle = computed(() => editingId.value ? 'Edit release' : 'New release')

onMounted(() => {
  resetForm()
  fetchNotes()
})
</script>

<template>
  <div class="admin-release-notes">
    <header class="page-header">
      <h1>What's New</h1>
      <p class="lead">Curate the release-notes panel in Settings. Drafts are admin-only; published rows are visible to everyone.</p>
    </header>

    <section class="form-section">
      <h2>{{ formTitle }}</h2>
      <div class="form-grid">
        <label class="field">
          <span class="field-label">Version</span>
          <input v-model="formVersion" type="text" placeholder="2026-05-21" class="input" />
        </label>
        <label class="field">
          <span class="field-label">Released</span>
          <input v-model="formReleasedAt" type="date" class="input" />
        </label>
        <label class="field field-wide">
          <span class="field-label">Headline (optional)</span>
          <input v-model="formHeadline" type="text" placeholder="LEGO tiles got smarter" class="input" />
        </label>
        <label class="field field-wide">
          <span class="field-label">Bullets <span class="field-hint">(one per line, plain text, ~3–5)</span></span>
          <textarea v-model="formBulletsText" rows="6" class="input textarea" placeholder="Tiles now show which words belong to the chunk you're learning&#10;Faster startup on slow connections&#10;…"></textarea>
        </label>
        <label class="field field-checkbox">
          <input v-model="formPublished" type="checkbox" />
          <span>Publish (visible to all users)</span>
        </label>
      </div>
      <div class="form-actions">
        <button class="btn primary" :disabled="isSaving" @click="save">
          {{ editingId ? 'Save changes' : 'Create release' }}
        </button>
        <button v-if="editingId" class="btn ghost" @click="resetForm">Cancel</button>
        <span v-if="flash" class="flash success">{{ flash }}</span>
        <span v-if="error" class="flash error">{{ error }}</span>
      </div>
    </section>

    <section class="list-section">
      <h2>All releases</h2>
      <div v-if="isLoading" class="muted">Loading…</div>
      <div v-else-if="notes.length === 0" class="muted">No releases yet — create the first one above.</div>
      <ul v-else class="release-list">
        <li v-for="n in notes" :key="n.id" class="release-row" :class="{ draft: !n.is_published }">
          <div class="row-head">
            <div>
              <span class="row-version">{{ n.version }}</span>
              <span class="row-date">{{ new Date(n.released_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) }}</span>
              <span v-if="!n.is_published" class="badge draft">Draft</span>
              <span v-else class="badge published">Published</span>
            </div>
            <div class="row-actions">
              <button class="btn small" @click="loadIntoForm(n)">Edit</button>
              <button class="btn small" @click="togglePublished(n)">
                {{ n.is_published ? 'Unpublish' : 'Publish' }}
              </button>
              <button class="btn small danger" @click="remove(n)">Delete</button>
            </div>
          </div>
          <div v-if="n.headline" class="row-headline">{{ n.headline }}</div>
          <ul class="row-bullets">
            <li v-for="(b, i) in n.bullets" :key="i">{{ b }}</li>
          </ul>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.admin-release-notes { max-width: 880px; margin: 0 auto; }

.page-header { margin-bottom: 24px; }
.page-header h1 { font-size: 1.6rem; margin: 0 0 4px; }
.lead { color: var(--schools-muted, #6b6b6b); margin: 0; }

h2 { font-size: 1.1rem; margin: 0 0 12px; }

.form-section, .list-section {
  background: #ffffff;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 10px;
  padding: 20px 22px;
  margin-bottom: 20px;
  box-shadow: 0 1px 3px rgba(44, 38, 34, 0.04);
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}
.field { display: flex; flex-direction: column; gap: 5px; }
.field-wide { grid-column: 1 / -1; }
.field-checkbox { flex-direction: row; align-items: center; gap: 8px; grid-column: 1 / -1; }
.field-label { font-size: 0.85rem; color: var(--schools-muted, #6b6b6b); font-weight: 500; }
.field-hint { color: var(--schools-muted, #6b6b6b); font-weight: 400; }
.input {
  font: inherit;
  padding: 8px 10px;
  border: 1px solid rgba(0, 0, 0, 0.18);
  border-radius: 6px;
  background: #fff;
}
.textarea { resize: vertical; min-height: 110px; font-family: inherit; }

.form-actions { display: flex; gap: 10px; align-items: center; margin-top: 16px; flex-wrap: wrap; }
.btn {
  font: inherit;
  padding: 7px 14px;
  border-radius: 6px;
  border: 1px solid rgba(0, 0, 0, 0.18);
  background: #fff;
  cursor: pointer;
}
.btn:hover { background: rgba(0, 0, 0, 0.03); }
.btn.primary {
  background: var(--ssi-red, #c23a3a);
  color: #fff;
  border-color: var(--ssi-red, #c23a3a);
}
.btn.primary:hover { background: var(--ssi-red-light, #d44a4a); }
.btn.ghost { background: transparent; }
.btn.danger { color: var(--ssi-red, #c23a3a); border-color: rgba(194, 58, 58, 0.4); }
.btn.danger:hover { background: rgba(194, 58, 58, 0.06); }
.btn.small { padding: 4px 10px; font-size: 0.85rem; }

.flash { font-size: 0.9rem; }
.flash.success { color: #2c8a3f; }
.flash.error { color: var(--ssi-red, #c23a3a); }
.muted { color: var(--schools-muted, #6b6b6b); }

.release-list { list-style: none; padding: 0; margin: 0; }
.release-row {
  padding: 14px 0;
  border-top: 1px solid rgba(0, 0, 0, 0.06);
}
.release-row:first-child { border-top: 0; padding-top: 0; }
.release-row.draft { opacity: 0.78; }
.row-head {
  display: flex; justify-content: space-between; align-items: center; gap: 10px;
  flex-wrap: wrap;
}
.row-version { font-weight: 600; margin-right: 10px; }
.row-date { color: var(--schools-muted, #6b6b6b); font-size: 0.9rem; margin-right: 10px; }
.row-headline { margin: 6px 0 4px; font-style: italic; color: #2a2a2a; }
.row-bullets { margin: 6px 0 0; padding-left: 22px; }
.row-bullets li { margin: 2px 0; }
.row-actions { display: flex; gap: 6px; }

.badge {
  display: inline-block;
  font-size: 0.75rem;
  padding: 2px 8px;
  border-radius: 999px;
  font-weight: 600;
}
.badge.draft { background: rgba(0, 0, 0, 0.06); color: #555; }
.badge.published { background: rgba(44, 138, 63, 0.12); color: #2c8a3f; }
</style>
