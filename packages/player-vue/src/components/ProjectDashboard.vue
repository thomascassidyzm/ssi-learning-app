<script setup>
import { ref, computed, onMounted, watch } from 'vue'

const emit = defineEmits(['close'])

// localStorage key
const STORAGE_KEY = 'ssi-roadmap-items'

// Collapsible sections state
const expandedSections = ref(new Set(['schools', 'ux', 'audio']))

const toggleSection = (area) => {
  if (expandedSections.value.has(area)) {
    expandedSections.value.delete(area)
  } else {
    expandedSections.value.add(area)
  }
}

// Area metadata with belt-inspired colors
const areaConfig = {
  schools: { label: 'Schools Dashboard', icon: '🏫', color: '#60a5fa' },   // blue
  audio: { label: 'Audio & Performance', icon: '🔊', color: '#a78bfa' },   // purple
  ux: { label: 'UX & Onboarding', icon: '✨', color: '#fcd34d' },          // yellow
  business: { label: 'Business Model', icon: '💰', color: '#4ade80' },     // green
  infrastructure: { label: 'Infrastructure', icon: '⚙️', color: '#fb923c' }, // orange
  content: { label: 'Content & Courses', icon: '📚', color: '#a8856c' },  // brown
}

// Editing state
const editingItem = ref(null)
const addingToArea = ref(null)
const newItem = ref({ title: '', description: '', tokenEstimate: 1, notes: '' })

// Roadmap items - this will be the live data for the meeting
const roadmapItems = ref([
  // Schools
  {
    id: 'schools-schema',
    title: 'Schools Supabase Schema',
    description: 'Create tables: schools, school_memberships, classes, class_enrollments',
    area: 'schools',
    status: 'planned',
    tokenEstimate: 2,
    notes: 'Migration file created, needs deployment'
  },
  {
    id: 'schools-code-flow',
    title: 'School Code Sign-up Flow',
    description: 'Add school code field to sign-up, auto-assign membership and role',
    area: 'schools',
    status: 'planned',
    tokenEstimate: 3,
    dependencies: ['schools-schema']
  },
  {
    id: 'schools-routing',
    title: 'Conditional Dashboard Routing',
    description: 'Check user school membership on login, route to schools dashboard vs player',
    area: 'schools',
    status: 'planned',
    tokenEstimate: 1,
    dependencies: ['schools-code-flow']
  },
  {
    id: 'schools-mockups',
    title: 'Convert Mockups to Vue',
    description: '6 dashboard pages + 7 user flows - HTML/CSS exists, needs componentizing',
    area: 'schools',
    status: 'planned',
    tokenEstimate: 8,
    notes: 'Parallelizable - can do all 6 pages simultaneously'
  },
  {
    id: 'schools-data-layer',
    title: 'Schools Data Queries',
    description: 'CRUD operations for schools, classes, students, progress aggregation',
    area: 'schools',
    status: 'planned',
    tokenEstimate: 3,
    dependencies: ['schools-schema']
  },

  // Audio & Performance
  {
    id: 'audio-preload-welcome',
    title: 'Preload Welcome Audio',
    description: 'Load welcome audio on course selection before navigation',
    area: 'audio',
    status: 'planned',
    tokenEstimate: 1,
  },
  {
    id: 'audio-preload-first',
    title: 'Preload First Round Audio',
    description: 'Prefetch intro + first 5 prompt/target pairs immediately',
    area: 'audio',
    status: 'planned',
    tokenEstimate: 2,
  },
  {
    id: 'audio-bundle-common',
    title: 'Bundle Common Welcome Segments',
    description: 'Standard welcome boilerplate built into app, only fetch course-specific opener',
    area: 'audio',
    status: 'planned',
    tokenEstimate: 3,
    notes: '90% of welcome is identical across courses'
  },
  {
    id: 'audio-offline-download',
    title: 'Offline Course Download',
    description: 'IndexedDB + Service Worker for full offline course access',
    area: 'audio',
    status: 'planned',
    tokenEstimate: 8,
    notes: 'Future - plan now, implement later'
  },

  // UX & Onboarding
  {
    id: 'ux-remove-postits',
    title: 'Remove Post-it Onboarding',
    description: 'Delete tutorial overlays - design should be self-explanatory',
    area: 'ux',
    status: 'planned',
    tokenEstimate: 1,
  },
  {
    id: 'ux-big-play-button',
    title: 'Super Obvious Play Button',
    description: 'Redesign home for instant clarity - big red button, nothing else',
    area: 'ux',
    status: 'planned',
    tokenEstimate: 2,
  },
  {
    id: 'ux-hover-disclosure',
    title: 'Progressive Hover Disclosure',
    description: 'Secondary features revealed on hover/interaction, not always visible',
    area: 'ux',
    status: 'planned',
    tokenEstimate: 3,
  },
  {
    id: 'ux-belt-explainer',
    title: 'Belt System Clarity',
    description: 'Visual explanation of belt progression - why it happens, what it means',
    area: 'ux',
    status: 'planned',
    tokenEstimate: 2,
  },
  {
    id: 'ux-optional-welcome',
    title: 'Optional Welcome Audio',
    description: 'Skip button or auto-skip for returning learners',
    area: 'ux',
    status: 'planned',
    tokenEstimate: 1,
  },

  // Business Model
  {
    id: 'biz-tier-visual',
    title: 'Visual Tier Explanation',
    description: 'Clear UI showing: anon (play), free (save), paid (premium courses)',
    area: 'business',
    status: 'planned',
    tokenEstimate: 3,
  },
  {
    id: 'biz-signin-prompt',
    title: 'Smart Sign-in Prompts',
    description: 'Prompt for account only when needed (to save progress, sync devices)',
    area: 'business',
    status: 'planned',
    tokenEstimate: 2,
  },
  {
    id: 'biz-community-courses',
    title: 'Community Course Badging',
    description: 'Clear "Free Forever" badge for endangered/heritage language courses',
    area: 'business',
    status: 'planned',
    tokenEstimate: 1,
  },
  {
    id: 'biz-virality-hooks',
    title: 'Sharing & Virality',
    description: 'Share progress, invite friends, community leaderboards',
    area: 'business',
    status: 'planned',
    tokenEstimate: 5,
    notes: 'Discussion item - what drives organic growth?'
  },

  // Infrastructure
  {
    id: 'infra-cache-invalidation',
    title: 'Build-version Cache Invalidation',
    description: 'Auto-clear stale caches on new deploys',
    area: 'infrastructure',
    status: 'done',
    tokenEstimate: 1,
  },
  {
    id: 'infra-project-dashboard',
    title: 'Project Dashboard (Meta)',
    description: 'This dashboard - self-documenting project management in-app',
    area: 'infrastructure',
    status: 'in-progress',
    tokenEstimate: 3,
  },
  {
    id: 'infra-apml-browser',
    title: 'APML Spec Browser',
    description: 'View/edit APML specs directly in the app',
    area: 'infrastructure',
    status: 'planned',
    tokenEstimate: 4,
  },

  // Content
  {
    id: 'content-welsh-intros',
    title: 'Welsh Course Intros',
    description: 'Fix intro audio playback for Welsh course',
    area: 'content',
    status: 'done',
    tokenEstimate: 2,
  },
  {
    id: 'content-spanish-cache',
    title: 'Spanish Course Caching',
    description: 'Handle large course (808 LEGOs) - exceeds localStorage quota',
    area: 'content',
    status: 'planned',
    tokenEstimate: 2,
    notes: 'May need IndexedDB for large courses'
  },
])

// Computed stats
const itemsByArea = computed(() => {
  const grouped = {}
  for (const area of Object.keys(areaConfig)) {
    grouped[area] = roadmapItems.value.filter(item => item.area === area)
  }
  return grouped
})

const overallStats = computed(() => {
  const items = roadmapItems.value
  const done = items.filter(i => i.status === 'done').length
  const inProgress = items.filter(i => i.status === 'in-progress').length
  const planned = items.filter(i => i.status === 'planned').length
  const totalTokens = items.reduce((sum, i) => sum + (i.tokenEstimate || 0), 0)
  const doneTokens = items.filter(i => i.status === 'done').reduce((sum, i) => sum + (i.tokenEstimate || 0), 0)
  return { done, inProgress, planned, total: items.length, totalTokens, doneTokens }
})

const progressPercent = computed(() => {
  if (overallStats.value.total === 0) return 0
  return Math.round((overallStats.value.done / overallStats.value.total) * 100)
})

// Status styling
const statusConfig = {
  done: { label: 'Done', color: '#4ade80', bg: 'rgba(74, 222, 128, 0.15)' },
  'in-progress': { label: 'In Progress', color: '#fcd34d', bg: 'rgba(252, 211, 77, 0.15)' },
  planned: { label: 'Planned', color: '#64748b', bg: 'rgba(100, 116, 139, 0.15)' },
}

// Cycle status on click
const cycleStatus = (item) => {
  const order = ['planned', 'in-progress', 'done']
  const current = order.indexOf(item.status)
  item.status = order[(current + 1) % order.length]
  saveToLocalStorage()
}

// Edit item
const startEditing = (item) => {
  editingItem.value = { ...item }
}

const saveEdit = () => {
  if (!editingItem.value) return
  const idx = roadmapItems.value.findIndex(i => i.id === editingItem.value.id)
  if (idx !== -1) {
    roadmapItems.value[idx] = { ...editingItem.value }
    saveToLocalStorage()
  }
  editingItem.value = null
}

const cancelEdit = () => {
  editingItem.value = null
}

const deleteItem = (itemId) => {
  roadmapItems.value = roadmapItems.value.filter(i => i.id !== itemId)
  editingItem.value = null
  saveToLocalStorage()
}

// Add new item
const startAdding = (area) => {
  addingToArea.value = area
  newItem.value = { title: '', description: '', tokenEstimate: 1, notes: '' }
}

const saveNewItem = () => {
  if (!addingToArea.value || !newItem.value.title.trim()) return
  const id = `${addingToArea.value}-${Date.now()}`
  roadmapItems.value.push({
    id,
    title: newItem.value.title.trim(),
    description: newItem.value.description.trim(),
    area: addingToArea.value,
    status: 'planned',
    tokenEstimate: newItem.value.tokenEstimate || 1,
    notes: newItem.value.notes.trim() || undefined,
  })
  saveToLocalStorage()
  addingToArea.value = null
  newItem.value = { title: '', description: '', tokenEstimate: 1, notes: '' }
}

const cancelAdd = () => {
  addingToArea.value = null
  newItem.value = { title: '', description: '', tokenEstimate: 1, notes: '' }
}

// localStorage persistence
const saveToLocalStorage = () => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(roadmapItems.value))
  } catch (e) {
    console.warn('[ProjectDashboard] Failed to save:', e)
  }
}

const loadFromLocalStorage = () => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      roadmapItems.value = JSON.parse(stored)
    }
  } catch (e) {
    console.warn('[ProjectDashboard] Failed to load:', e)
  }
}

// Load on mount
onMounted(() => {
  loadFromLocalStorage()
})
</script>

<template>
  <div class="project-dashboard">
    <!-- Background layers -->
    <div class="bg-gradient"></div>
    <div class="bg-grid"></div>
    <div class="bg-noise"></div>

    <!-- Header -->
    <header class="header">
      <button class="back-btn" @click="$emit('close')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M15 18l-6-6 6-6"/>
        </svg>
      </button>
      <div class="header-content">
        <h1>Project Dashboard</h1>
        <span class="subtitle">SSi Learning App Roadmap</span>
      </div>
    </header>

    <!-- Stats bar -->
    <div class="stats-bar">
      <div class="stat">
        <span class="stat-value">{{ overallStats.done }}</span>
        <span class="stat-label">Done</span>
      </div>
      <div class="stat">
        <span class="stat-value">{{ overallStats.inProgress }}</span>
        <span class="stat-label">Active</span>
      </div>
      <div class="stat">
        <span class="stat-value">{{ overallStats.planned }}</span>
        <span class="stat-label">Planned</span>
      </div>
      <div class="stat tokens">
        <span class="stat-value">{{ overallStats.totalTokens }}k</span>
        <span class="stat-label">Est. Tokens</span>
      </div>
    </div>

    <!-- Progress bar -->
    <div class="progress-section">
      <div class="progress-bar">
        <div class="progress-fill" :style="{ width: progressPercent + '%' }"></div>
      </div>
      <span class="progress-label">{{ progressPercent }}% Complete</span>
    </div>

    <!-- Roadmap sections -->
    <div class="roadmap">
      <div
        v-for="(config, area) in areaConfig"
        :key="area"
        class="area-section"
      >
        <button
          class="area-header"
          @click="toggleSection(area)"
          :style="{ '--area-color': config.color }"
        >
          <span class="area-icon">{{ config.icon }}</span>
          <span class="area-label">{{ config.label }}</span>
          <span class="area-count">{{ itemsByArea[area].length }}</span>
          <svg
            class="chevron"
            :class="{ expanded: expandedSections.has(area) }"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M6 9l6 6 6-6"/>
          </svg>
        </button>

        <Transition name="collapse">
          <div v-if="expandedSections.has(area)" class="area-items">
            <div
              v-for="item in itemsByArea[area]"
              :key="item.id"
              class="roadmap-item"
              :class="item.status"
            >
              <button
                class="status-dot"
                :style="{
                  backgroundColor: statusConfig[item.status].bg,
                  borderColor: statusConfig[item.status].color
                }"
                @click.stop="cycleStatus(item)"
                :title="'Click to change status'"
              >
                <span
                  class="dot-inner"
                  :style="{ backgroundColor: statusConfig[item.status].color }"
                ></span>
              </button>

              <div class="item-content" @click="startEditing(item)">
                <h3 class="item-title">{{ item.title }}</h3>
                <p class="item-desc">{{ item.description }}</p>

                <div class="item-meta">
                  <span
                    class="status-badge"
                    :style="{
                      backgroundColor: statusConfig[item.status].bg,
                      color: statusConfig[item.status].color
                    }"
                  >
                    {{ statusConfig[item.status].label }}
                  </span>

                  <span v-if="item.tokenEstimate" class="token-estimate">
                    ~{{ item.tokenEstimate }}k tokens
                  </span>

                  <span v-if="item.dependencies?.length" class="dependencies">
                    → {{ item.dependencies.join(', ') }}
                  </span>
                </div>

                <p v-if="item.notes" class="item-notes">{{ item.notes }}</p>
              </div>
            </div>

            <!-- Add item button -->
            <button class="add-item-btn" @click="startAdding(area)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 5v14M5 12h14"/>
              </svg>
              Add Item
            </button>
          </div>
        </Transition>
      </div>
    </div>

    <!-- Footer -->
    <footer class="footer">
      <p>Click items to edit • Status dots to cycle • Token estimates in thousands</p>
    </footer>

    <!-- Edit Modal -->
    <Transition name="fade">
      <div v-if="editingItem" class="modal-overlay" @click.self="cancelEdit">
        <div class="modal">
          <h2>Edit Item</h2>
          <div class="form-group">
            <label>Title</label>
            <input v-model="editingItem.title" type="text" placeholder="Item title" />
          </div>
          <div class="form-group">
            <label>Description</label>
            <textarea v-model="editingItem.description" placeholder="Description" rows="2"></textarea>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Tokens (k)</label>
              <input v-model.number="editingItem.tokenEstimate" type="number" min="1" />
            </div>
            <div class="form-group">
              <label>Status</label>
              <select v-model="editingItem.status">
                <option value="planned">Planned</option>
                <option value="in-progress">In Progress</option>
                <option value="done">Done</option>
              </select>
            </div>
          </div>
          <div class="form-group">
            <label>Notes (optional)</label>
            <input v-model="editingItem.notes" type="text" placeholder="Additional notes" />
          </div>
          <div class="modal-actions">
            <button class="btn-delete" @click="deleteItem(editingItem.id)">Delete</button>
            <div class="modal-actions-right">
              <button class="btn-cancel" @click="cancelEdit">Cancel</button>
              <button class="btn-save" @click="saveEdit">Save</button>
            </div>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Add Modal -->
    <Transition name="fade">
      <div v-if="addingToArea" class="modal-overlay" @click.self="cancelAdd">
        <div class="modal">
          <h2>Add Item to {{ areaConfig[addingToArea]?.label }}</h2>
          <div class="form-group">
            <label>Title</label>
            <input v-model="newItem.title" type="text" placeholder="Item title" />
          </div>
          <div class="form-group">
            <label>Description</label>
            <textarea v-model="newItem.description" placeholder="Description" rows="2"></textarea>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Tokens (k)</label>
              <input v-model.number="newItem.tokenEstimate" type="number" min="1" />
            </div>
          </div>
          <div class="form-group">
            <label>Notes (optional)</label>
            <input v-model="newItem.notes" type="text" placeholder="Additional notes" />
          </div>
          <div class="modal-actions">
            <div></div>
            <div class="modal-actions-right">
              <button class="btn-cancel" @click="cancelAdd">Cancel</button>
              <button class="btn-save" @click="saveNewItem" :disabled="!newItem.title.trim()">Add</button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.project-dashboard {
  position: fixed;
  inset: 0;
  background: #0a0a0f;
  color: #e2e8f0;
  overflow-y: auto;
  overflow-x: hidden;
  font-family: 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif;
}

/* Background layers */
.bg-gradient {
  position: fixed;
  inset: 0;
  z-index: 0;
  background:
    radial-gradient(ellipse at 20% 0%, rgba(96, 165, 250, 0.04) 0%, transparent 50%),
    radial-gradient(ellipse at 80% 100%, rgba(167, 139, 250, 0.03) 0%, transparent 50%),
    #0a0a0f;
  pointer-events: none;
}

.bg-grid {
  position: fixed;
  inset: 0;
  z-index: 0;
  background-image:
    linear-gradient(rgba(255,255,255,0.015) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,0.015) 1px, transparent 1px);
  background-size: 50px 50px;
  pointer-events: none;
}

.bg-noise {
  position: fixed;
  inset: 0;
  z-index: 0;
  opacity: 0.08;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E");
  pointer-events: none;
}

/* Header */
.header {
  position: sticky;
  top: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem 1.5rem;
  background: rgba(10, 10, 15, 0.8);
  backdrop-filter: blur(20px);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.back-btn {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #94a3b8;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
}

.back-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #e2e8f0;
}

.back-btn svg {
  width: 20px;
  height: 20px;
}

.header-content h1 {
  font-size: 1.25rem;
  font-weight: 600;
  color: #f1f5f9;
  margin: 0;
  letter-spacing: -0.02em;
}

.subtitle {
  font-size: 0.75rem;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

/* Stats bar */
.stats-bar {
  position: relative;
  z-index: 1;
  display: flex;
  gap: 0.5rem;
  padding: 1rem 1.5rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}

.stat {
  flex: 1;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 12px;
  padding: 0.75rem;
  text-align: center;
}

.stat-value {
  display: block;
  font-size: 1.5rem;
  font-weight: 700;
  color: #f1f5f9;
  letter-spacing: -0.02em;
}

.stat-label {
  display: block;
  font-size: 0.65rem;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-top: 0.25rem;
}

.stat.tokens {
  background: rgba(167, 139, 250, 0.08);
  border-color: rgba(167, 139, 250, 0.2);
}

.stat.tokens .stat-value {
  color: #a78bfa;
}

/* Progress section */
.progress-section {
  position: relative;
  z-index: 1;
  padding: 0 1.5rem 1rem;
  display: flex;
  align-items: center;
  gap: 1rem;
}

.progress-bar {
  flex: 1;
  height: 6px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 3px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #4ade80, #22c55e);
  border-radius: 3px;
  transition: width 0.5s ease;
}

.progress-label {
  font-size: 0.75rem;
  color: #4ade80;
  font-weight: 500;
}

/* Roadmap sections */
.roadmap {
  position: relative;
  z-index: 1;
  padding: 0.5rem 1rem 6rem;
}

.area-section {
  margin-bottom: 0.5rem;
}

.area-header {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 1rem;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
  color: #e2e8f0;
  text-align: left;
}

.area-header:hover {
  background: rgba(255, 255, 255, 0.05);
  border-color: var(--area-color, rgba(255, 255, 255, 0.1));
}

.area-icon {
  font-size: 1.25rem;
}

.area-label {
  flex: 1;
  font-weight: 600;
  font-size: 0.95rem;
  color: var(--area-color, #e2e8f0);
}

.area-count {
  font-size: 0.75rem;
  color: #64748b;
  background: rgba(255, 255, 255, 0.06);
  padding: 0.25rem 0.5rem;
  border-radius: 6px;
}

.chevron {
  width: 20px;
  height: 20px;
  color: #64748b;
  transition: transform 0.2s ease;
}

.chevron.expanded {
  transform: rotate(180deg);
}

/* Area items */
.area-items {
  padding: 0.5rem 0 0 0;
}

.roadmap-item {
  display: flex;
  gap: 1rem;
  padding: 1rem;
  margin-bottom: 0.5rem;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.04);
  border-radius: 10px;
  transition: all 0.2s ease;
}

.roadmap-item:hover {
  background: rgba(255, 255, 255, 0.04);
}

.roadmap-item.done {
  opacity: 0.7;
}

.status-dot {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 2px solid;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
  flex-shrink: 0;
  margin-top: 2px;
}

.status-dot:hover {
  transform: scale(1.1);
}

.dot-inner {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}

.item-content {
  flex: 1;
  min-width: 0;
  cursor: pointer;
}

.item-content:hover .item-title {
  color: #60a5fa;
}

.item-title {
  font-size: 0.95rem;
  font-weight: 600;
  color: #f1f5f9;
  margin: 0 0 0.25rem;
}

.roadmap-item.done .item-title {
  text-decoration: line-through;
  color: #94a3b8;
}

.item-desc {
  font-size: 0.8rem;
  color: #94a3b8;
  margin: 0 0 0.5rem;
  line-height: 1.4;
}

.item-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}

.status-badge {
  font-size: 0.65rem;
  font-weight: 600;
  padding: 0.2rem 0.5rem;
  border-radius: 4px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.token-estimate {
  font-size: 0.7rem;
  color: #a78bfa;
  font-weight: 500;
}

.dependencies {
  font-size: 0.7rem;
  color: #64748b;
  font-style: italic;
}

.item-notes {
  font-size: 0.75rem;
  color: #fcd34d;
  margin: 0.5rem 0 0;
  padding: 0.5rem;
  background: rgba(252, 211, 77, 0.08);
  border-radius: 6px;
  border-left: 2px solid rgba(252, 211, 77, 0.4);
}

/* Collapse animation */
.collapse-enter-active,
.collapse-leave-active {
  transition: all 0.3s ease;
  overflow: hidden;
}

.collapse-enter-from,
.collapse-leave-to {
  opacity: 0;
  max-height: 0;
}

.collapse-enter-to,
.collapse-leave-from {
  opacity: 1;
  max-height: 2000px;
}

/* Add item button */
.add-item-btn {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.75rem;
  margin-top: 0.5rem;
  background: transparent;
  border: 1px dashed rgba(255, 255, 255, 0.15);
  border-radius: 8px;
  color: #64748b;
  font-size: 0.8rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.add-item-btn:hover {
  border-color: #60a5fa;
  color: #60a5fa;
  background: rgba(96, 165, 250, 0.05);
}

.add-item-btn svg {
  width: 16px;
  height: 16px;
}

/* Modal */
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}

.modal {
  background: #1a1a24;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 16px;
  padding: 1.5rem;
  width: 100%;
  max-width: 400px;
  max-height: 90vh;
  overflow-y: auto;
}

.modal h2 {
  font-size: 1.1rem;
  font-weight: 600;
  color: #f1f5f9;
  margin: 0 0 1.25rem;
}

.form-group {
  margin-bottom: 1rem;
}

.form-group label {
  display: block;
  font-size: 0.75rem;
  color: #94a3b8;
  margin-bottom: 0.375rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.form-group input,
.form-group textarea,
.form-group select {
  width: 100%;
  padding: 0.625rem 0.75rem;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  color: #f1f5f9;
  font-size: 0.875rem;
  font-family: inherit;
}

.form-group input:focus,
.form-group textarea:focus,
.form-group select:focus {
  outline: none;
  border-color: #60a5fa;
}

.form-group textarea {
  resize: vertical;
  min-height: 60px;
}

.form-group select {
  cursor: pointer;
}

.form-row {
  display: flex;
  gap: 1rem;
}

.form-row .form-group {
  flex: 1;
}

.modal-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 1.5rem;
  padding-top: 1rem;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.modal-actions-right {
  display: flex;
  gap: 0.5rem;
}

.btn-cancel,
.btn-save,
.btn-delete {
  padding: 0.5rem 1rem;
  border-radius: 8px;
  font-size: 0.8rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-cancel {
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #94a3b8;
}

.btn-cancel:hover {
  background: rgba(255, 255, 255, 0.05);
  color: #e2e8f0;
}

.btn-save {
  background: #60a5fa;
  border: none;
  color: #0a0a0f;
}

.btn-save:hover {
  background: #3b82f6;
}

.btn-save:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-delete {
  background: transparent;
  border: 1px solid rgba(239, 68, 68, 0.3);
  color: #ef4444;
}

.btn-delete:hover {
  background: rgba(239, 68, 68, 0.1);
}

/* Fade transition */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* Footer */
.footer {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 1rem;
  background: linear-gradient(transparent, rgba(10, 10, 15, 0.95));
  text-align: center;
}

.footer p {
  font-size: 0.7rem;
  color: #475569;
  margin: 0;
}

/* Mobile adjustments */
@media (max-width: 480px) {
  .stats-bar {
    flex-wrap: wrap;
  }

  .stat {
    min-width: calc(50% - 0.25rem);
  }

  .item-meta {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
