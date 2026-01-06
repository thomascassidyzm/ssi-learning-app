<script setup>
import { ref, computed, onMounted, nextTick } from 'vue'

const emit = defineEmits(['close'])

// localStorage keys
const STORAGE_KEY = 'ssi-roadmap-items'
const WINS_STORAGE_KEY = 'ssi-agile-wins'

// Current date info
const now = new Date()
const currentYear = now.getFullYear()
const currentQuarter = Math.ceil((now.getMonth() + 1) / 3)
const currentMonth = now.toLocaleString('default', { month: 'long' })

// Collapsible sections state
const expandedSections = ref(new Set(['wins', 'schools', 'data']))

// Which item is expanded for editing (by id)
const expandedItemId = ref(null)

// Which area is showing the add form
const addingToArea = ref(null)
const newItem = ref({ title: '', description: '', tokenEstimate: 1, notes: '', quarter: null })

// Drag state
const draggedItem = ref(null)
const dragOverItem = ref(null)

// 3 Wins - Agile Results
const wins = ref({
  year: [
    'SSi Learning App live with paying subscribers',
    'Schools dashboard operational with pilot schools',
    'Community course creation pipeline proven'
  ],
  quarter: [
    'saysomethingin.app fully operational (new SSi Learning App)',
    'popty.app fully operational with new versions of Big 10 published',
    'Community-created course system (Popty + Learning App) fully operational'
  ],
  month: ['', '', '']
})

const toggleSection = (area) => {
  if (expandedSections.value.has(area)) {
    expandedSections.value.delete(area)
  } else {
    expandedSections.value.add(area)
  }
}

const toggleItemExpand = (itemId) => {
  if (expandedItemId.value === itemId) {
    expandedItemId.value = null
  } else {
    expandedItemId.value = itemId
    addingToArea.value = null
  }
}

// Area metadata with belt-inspired colors
const areaConfig = {
  schools: { label: 'Schools Dashboard', icon: '🏫', color: '#60a5fa' },
  data: { label: 'Data & Insights', icon: '📊', color: '#f472b6' },
  audio: { label: 'Audio & Performance', icon: '🔊', color: '#a78bfa' },
  ux: { label: 'UX & Onboarding', icon: '✨', color: '#fcd34d' },
  business: { label: 'Business Model', icon: '💰', color: '#4ade80' },
  infrastructure: { label: 'Infrastructure', icon: '⚙️', color: '#fb923c' },
  content: { label: 'Content & Courses', icon: '📚', color: '#a8856c' },
}

// Quarter options
const quarters = [
  { value: null, label: 'Unscheduled' },
  { value: 'Q1', label: 'Q1 (Jan-Mar)' },
  { value: 'Q2', label: 'Q2 (Apr-Jun)' },
  { value: 'Q3', label: 'Q3 (Jul-Sep)' },
  { value: 'Q4', label: 'Q4 (Oct-Dec)' },
]

// Roadmap items
const roadmapItems = ref([
  // Schools
  {
    id: 'schools-schema',
    title: 'Schools Supabase Schema',
    description: 'Create tables: schools, school_memberships, classes, class_enrollments',
    area: 'schools',
    status: 'planned',
    tokenEstimate: 2,
    quarter: 'Q1',
    notes: 'Migration file created, needs deployment'
  },
  {
    id: 'schools-code-flow',
    title: 'School Code Sign-up Flow',
    description: 'Add school code field to sign-up, auto-assign membership and role',
    area: 'schools',
    status: 'planned',
    tokenEstimate: 3,
    quarter: 'Q1',
    dependencies: ['schools-schema']
  },
  {
    id: 'schools-routing',
    title: 'Conditional Dashboard Routing',
    description: 'Check user school membership on login, route to schools dashboard vs player',
    area: 'schools',
    status: 'planned',
    tokenEstimate: 1,
    quarter: 'Q1',
    dependencies: ['schools-code-flow']
  },
  {
    id: 'schools-mockups',
    title: 'Convert Mockups to Vue',
    description: '6 dashboard pages + 7 user flows - HTML/CSS exists, needs componentizing',
    area: 'schools',
    status: 'planned',
    tokenEstimate: 8,
    quarter: 'Q1',
    notes: 'Parallelizable - can do all 6 pages simultaneously'
  },
  {
    id: 'schools-data-layer',
    title: 'Schools Data Queries',
    description: 'CRUD operations for schools, classes, students, progress aggregation',
    area: 'schools',
    status: 'planned',
    tokenEstimate: 3,
    quarter: 'Q1',
    dependencies: ['schools-schema']
  },

  // Data & Insights (NEW)
  {
    id: 'data-anonymous-tracking',
    title: 'Anonymous User Behaviour',
    description: 'Track session starts, completion rates, drop-off points for non-authenticated users',
    area: 'data',
    status: 'planned',
    tokenEstimate: 3,
    quarter: 'Q1',
    notes: 'GDPR compliant - no PII for anonymous'
  },
  {
    id: 'data-learning-analytics',
    title: 'Learning Performance Metrics',
    description: 'Track response times, error patterns, belt progression velocity per user',
    area: 'data',
    status: 'planned',
    tokenEstimate: 4,
    quarter: 'Q1',
  },
  {
    id: 'data-cohort-analysis',
    title: 'Cohort & Retention Analysis',
    description: 'Day 1/7/30 retention, cohort comparison, churn prediction signals',
    area: 'data',
    status: 'planned',
    tokenEstimate: 5,
    quarter: 'Q2',
  },
  {
    id: 'data-segment-free-users',
    title: 'Free User Segmentation',
    description: 'Identify power users, casual browsers, potential converts based on behaviour',
    area: 'data',
    status: 'planned',
    tokenEstimate: 3,
    quarter: 'Q2',
  },
  {
    id: 'data-conversion-funnel',
    title: 'Conversion Funnel Tracking',
    description: 'Anonymous → Signed up → Active → Paid journey with drop-off analysis',
    area: 'data',
    status: 'planned',
    tokenEstimate: 4,
    quarter: 'Q2',
  },
  {
    id: 'data-in-app-messaging',
    title: 'In-App Communication System',
    description: 'Contextual tips, milestone celebrations, re-engagement nudges',
    area: 'data',
    status: 'planned',
    tokenEstimate: 5,
    quarter: 'Q2',
    notes: 'Non-intrusive, learner-first approach'
  },
  {
    id: 'data-ab-testing',
    title: 'A/B Testing Framework',
    description: 'Test onboarding flows, UI variations, pricing strategies',
    area: 'data',
    status: 'planned',
    tokenEstimate: 6,
    quarter: 'Q3',
  },
  {
    id: 'data-dashboard-internal',
    title: 'Internal Analytics Dashboard',
    description: 'Real-time view of active learners, course popularity, system health',
    area: 'data',
    status: 'planned',
    tokenEstimate: 8,
    quarter: 'Q3',
  },
  {
    id: 'data-learner-insights',
    title: 'Learner Insights for Teachers',
    description: 'Class-level analytics for schools - struggling students, progress trends',
    area: 'data',
    status: 'planned',
    tokenEstimate: 5,
    quarter: 'Q3',
    dependencies: ['schools-data-layer']
  },

  // Audio & Performance
  {
    id: 'audio-preload-welcome',
    title: 'Preload Welcome Audio',
    description: 'Load welcome audio on course selection before navigation',
    area: 'audio',
    status: 'planned',
    tokenEstimate: 1,
    quarter: 'Q1',
  },
  {
    id: 'audio-preload-first',
    title: 'Preload First Round Audio',
    description: 'Prefetch intro + first 5 prompt/target pairs immediately',
    area: 'audio',
    status: 'planned',
    tokenEstimate: 2,
    quarter: 'Q1',
  },
  {
    id: 'audio-bundle-common',
    title: 'Bundle Common Welcome Segments',
    description: 'Standard welcome boilerplate built into app, only fetch course-specific opener',
    area: 'audio',
    status: 'planned',
    tokenEstimate: 3,
    quarter: 'Q2',
    notes: '90% of welcome is identical across courses'
  },
  {
    id: 'audio-offline-download',
    title: 'Offline Course Download',
    description: 'IndexedDB + Service Worker for full offline course access',
    area: 'audio',
    status: 'planned',
    tokenEstimate: 8,
    quarter: 'Q4',
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
    quarter: 'Q1',
  },
  {
    id: 'ux-big-play-button',
    title: 'Super Obvious Play Button',
    description: 'Redesign home for instant clarity - big red button, nothing else',
    area: 'ux',
    status: 'planned',
    tokenEstimate: 2,
    quarter: 'Q1',
  },
  {
    id: 'ux-hover-disclosure',
    title: 'Progressive Hover Disclosure',
    description: 'Secondary features revealed on hover/interaction, not always visible',
    area: 'ux',
    status: 'planned',
    tokenEstimate: 3,
    quarter: 'Q2',
  },
  {
    id: 'ux-belt-explainer',
    title: 'Belt System Clarity',
    description: 'Visual explanation of belt progression - why it happens, what it means',
    area: 'ux',
    status: 'planned',
    tokenEstimate: 2,
    quarter: 'Q2',
  },
  {
    id: 'ux-optional-welcome',
    title: 'Optional Welcome Audio',
    description: 'Skip button or auto-skip for returning learners',
    area: 'ux',
    status: 'planned',
    tokenEstimate: 1,
    quarter: 'Q1',
  },

  // Business Model
  {
    id: 'biz-tier-visual',
    title: 'Visual Tier Explanation',
    description: 'Clear UI showing: anon (play), free (save), paid (premium courses)',
    area: 'business',
    status: 'planned',
    tokenEstimate: 3,
    quarter: 'Q2',
  },
  {
    id: 'biz-signin-prompt',
    title: 'Smart Sign-in Prompts',
    description: 'Prompt for account only when needed (to save progress, sync devices)',
    area: 'business',
    status: 'planned',
    tokenEstimate: 2,
    quarter: 'Q2',
  },
  {
    id: 'biz-community-courses',
    title: 'Community Course Badging',
    description: 'Clear "Free Forever" badge for endangered/heritage language courses',
    area: 'business',
    status: 'planned',
    tokenEstimate: 1,
    quarter: 'Q3',
  },
  {
    id: 'biz-virality-hooks',
    title: 'Sharing & Virality',
    description: 'Share progress, invite friends, community leaderboards',
    area: 'business',
    status: 'planned',
    tokenEstimate: 5,
    quarter: 'Q3',
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
    quarter: 'Q1',
  },
  {
    id: 'infra-project-dashboard',
    title: 'Project Dashboard (Meta)',
    description: 'This dashboard - self-documenting project management in-app',
    area: 'infrastructure',
    status: 'in-progress',
    tokenEstimate: 3,
    quarter: 'Q1',
  },
  {
    id: 'infra-apml-browser',
    title: 'APML Spec Browser',
    description: 'View/edit APML specs directly in the app',
    area: 'infrastructure',
    status: 'planned',
    tokenEstimate: 4,
    quarter: 'Q4',
  },

  // Content
  {
    id: 'content-welsh-intros',
    title: 'Welsh Course Intros',
    description: 'Fix intro audio playback for Welsh course',
    area: 'content',
    status: 'done',
    tokenEstimate: 2,
    quarter: 'Q1',
  },
  {
    id: 'content-spanish-cache',
    title: 'Spanish Course Caching',
    description: 'Handle large course (808 LEGOs) - exceeds localStorage quota',
    area: 'content',
    status: 'planned',
    tokenEstimate: 2,
    quarter: 'Q1',
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

const quarterStats = computed(() => {
  const stats = {}
  for (const q of ['Q1', 'Q2', 'Q3', 'Q4']) {
    const items = roadmapItems.value.filter(i => i.quarter === q)
    stats[q] = {
      total: items.length,
      done: items.filter(i => i.status === 'done').length,
      tokens: items.reduce((sum, i) => sum + (i.tokenEstimate || 0), 0)
    }
  }
  return stats
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
const cycleStatus = (item, e) => {
  e.stopPropagation()
  const order = ['planned', 'in-progress', 'done']
  const current = order.indexOf(item.status)
  item.status = order[(current + 1) % order.length]
  saveToLocalStorage()
}

// Delete item
const deleteItem = (itemId, e) => {
  e.stopPropagation()
  roadmapItems.value = roadmapItems.value.filter(i => i.id !== itemId)
  expandedItemId.value = null
  saveToLocalStorage()
}

// Add new item
const startAdding = (area) => {
  addingToArea.value = area
  expandedItemId.value = null
  newItem.value = { title: '', description: '', tokenEstimate: 1, notes: '', quarter: `Q${currentQuarter}` }
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
    quarter: newItem.value.quarter || null,
    notes: newItem.value.notes.trim() || undefined,
  })
  saveToLocalStorage()
  addingToArea.value = null
  newItem.value = { title: '', description: '', tokenEstimate: 1, notes: '', quarter: null }
}

const cancelAdd = () => {
  addingToArea.value = null
  newItem.value = { title: '', description: '', tokenEstimate: 1, notes: '', quarter: null }
}

// Drag and drop handlers
const onDragStart = (e, item, area) => {
  draggedItem.value = { item, area }
  e.dataTransfer.effectAllowed = 'move'
  e.target.classList.add('dragging')
}

const onDragEnd = (e) => {
  e.target.classList.remove('dragging')
  draggedItem.value = null
  dragOverItem.value = null
}

const onDragOver = (e, item, area) => {
  e.preventDefault()
  if (!draggedItem.value || draggedItem.value.area !== area) return
  if (draggedItem.value.item.id === item.id) return
  dragOverItem.value = item.id
}

const onDragLeave = () => {
  dragOverItem.value = null
}

const onDrop = (e, targetItem, area) => {
  e.preventDefault()
  if (!draggedItem.value || draggedItem.value.area !== area) return

  const items = roadmapItems.value
  const draggedIdx = items.findIndex(i => i.id === draggedItem.value.item.id)
  const targetIdx = items.findIndex(i => i.id === targetItem.id)

  if (draggedIdx !== -1 && targetIdx !== -1) {
    const [removed] = items.splice(draggedIdx, 1)
    items.splice(targetIdx, 0, removed)
    saveToLocalStorage()
  }

  draggedItem.value = null
  dragOverItem.value = null
}

// localStorage persistence
const saveToLocalStorage = () => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(roadmapItems.value))
  } catch (e) {
    console.warn('[ProjectDashboard] Failed to save items:', e)
  }
}

const loadFromLocalStorage = () => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      roadmapItems.value = JSON.parse(stored)
    }
  } catch (e) {
    console.warn('[ProjectDashboard] Failed to load items:', e)
  }
}

// Wins persistence
const saveWins = () => {
  try {
    localStorage.setItem(WINS_STORAGE_KEY, JSON.stringify(wins.value))
  } catch (e) {
    console.warn('[ProjectDashboard] Failed to save wins:', e)
  }
}

// Default wins (used if localStorage is empty)
const defaultWins = {
  year: [
    'SSi Learning App live with paying subscribers',
    'Schools dashboard operational with pilot schools',
    'Community course creation pipeline proven'
  ],
  quarter: [
    'saysomethingin.app fully operational (new SSi Learning App)',
    'popty.app fully operational with new versions of Big 10 published',
    'Community-created course system (Popty + Learning App) fully operational'
  ],
  month: ['', '', '']
}

const loadWins = () => {
  try {
    const stored = localStorage.getItem(WINS_STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      // Use defaults if stored quarter wins are all empty
      const hasQuarterWins = parsed.quarter?.some(w => w && w.trim())
      if (!hasQuarterWins) {
        wins.value = { ...defaultWins }
        saveWins()
      } else {
        wins.value = parsed
      }
    }
  } catch (e) {
    console.warn('[ProjectDashboard] Failed to load wins:', e)
  }
}

const updateWin = (level, index, value) => {
  wins.value[level][index] = value
  saveWins()
}

// Auto-save on any item change
const updateItem = (item, field, value) => {
  item[field] = value
  saveToLocalStorage()
}

// Load on mount
onMounted(() => {
  loadFromLocalStorage()
  loadWins()
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
        <span class="subtitle">SSi Learning App {{ currentYear }}</span>
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

    <!-- Quarter overview -->
    <div class="quarter-bar">
      <div
        v-for="q in ['Q1', 'Q2', 'Q3', 'Q4']"
        :key="q"
        class="quarter-stat"
        :class="{ current: q === `Q${currentQuarter}` }"
      >
        <span class="q-label">{{ q }}</span>
        <span class="q-progress">{{ quarterStats[q].done }}/{{ quarterStats[q].total }}</span>
        <span class="q-tokens">{{ quarterStats[q].tokens }}k</span>
      </div>
    </div>

    <!-- Progress bar -->
    <div class="progress-section">
      <div class="progress-bar">
        <div class="progress-fill" :style="{ width: progressPercent + '%' }"></div>
      </div>
      <span class="progress-label">{{ progressPercent }}% Complete</span>
    </div>

    <!-- Main content -->
    <div class="roadmap">
      <!-- 3 Wins Section -->
      <div class="area-section wins-section">
        <button
          class="area-header wins-header"
          @click="toggleSection('wins')"
        >
          <span class="area-icon">🎯</span>
          <span class="area-label">3 Wins - Agile Results</span>
          <svg
            class="chevron"
            :class="{ expanded: expandedSections.has('wins') }"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M6 9l6 6 6-6"/>
          </svg>
        </button>

        <Transition name="collapse">
          <div v-if="expandedSections.has('wins')" class="wins-content">
            <!-- Year Wins -->
            <div class="wins-level">
              <h3 class="wins-title">
                <span class="wins-icon">📅</span>
                This Year ({{ currentYear }})
              </h3>
              <div class="wins-list">
                <div v-for="(win, idx) in wins.year" :key="'year-'+idx" class="win-item">
                  <span class="win-number">{{ idx + 1 }}</span>
                  <input
                    type="text"
                    :value="win"
                    @input="updateWin('year', idx, $event.target.value)"
                    placeholder="Enter yearly win..."
                    class="win-input"
                  />
                </div>
              </div>
            </div>

            <!-- Quarter Wins -->
            <div class="wins-level">
              <h3 class="wins-title">
                <span class="wins-icon">🎯</span>
                This Quarter (Q{{ currentQuarter }})
              </h3>
              <div class="wins-list">
                <div v-for="(win, idx) in wins.quarter" :key="'quarter-'+idx" class="win-item">
                  <span class="win-number">{{ idx + 1 }}</span>
                  <input
                    type="text"
                    :value="win"
                    @input="updateWin('quarter', idx, $event.target.value)"
                    placeholder="Enter quarterly win..."
                    class="win-input"
                  />
                </div>
              </div>
            </div>

            <!-- Month Wins -->
            <div class="wins-level">
              <h3 class="wins-title">
                <span class="wins-icon">🌙</span>
                This Month ({{ currentMonth }})
              </h3>
              <div class="wins-list">
                <div v-for="(win, idx) in wins.month" :key="'month-'+idx" class="win-item">
                  <span class="win-number">{{ idx + 1 }}</span>
                  <input
                    type="text"
                    :value="win"
                    @input="updateWin('month', idx, $event.target.value)"
                    placeholder="Enter monthly win..."
                    class="win-input"
                  />
                </div>
              </div>
            </div>
          </div>
        </Transition>
      </div>

      <!-- Roadmap sections -->
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
              :class="[
                item.status,
                { expanded: expandedItemId === item.id },
                { 'drag-over': dragOverItem === item.id }
              ]"
              draggable="true"
              @dragstart="onDragStart($event, item, area)"
              @dragend="onDragEnd"
              @dragover="onDragOver($event, item, area)"
              @dragleave="onDragLeave"
              @drop="onDrop($event, item, area)"
            >
              <!-- Item header (always visible) -->
              <div class="item-header" @click="toggleItemExpand(item.id)">
                <div class="drag-handle" title="Drag to reorder">
                  <svg viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="9" cy="6" r="1.5"/>
                    <circle cx="15" cy="6" r="1.5"/>
                    <circle cx="9" cy="12" r="1.5"/>
                    <circle cx="15" cy="12" r="1.5"/>
                    <circle cx="9" cy="18" r="1.5"/>
                    <circle cx="15" cy="18" r="1.5"/>
                  </svg>
                </div>

                <button
                  class="status-dot"
                  :style="{
                    backgroundColor: statusConfig[item.status].bg,
                    borderColor: statusConfig[item.status].color
                  }"
                  @click="cycleStatus(item, $event)"
                  title="Click to change status"
                >
                  <span
                    class="dot-inner"
                    :style="{ backgroundColor: statusConfig[item.status].color }"
                  ></span>
                </button>

                <div class="item-summary">
                  <h3 class="item-title">{{ item.title }}</h3>
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
                    <span v-if="item.quarter" class="quarter-badge">{{ item.quarter }}</span>
                    <span v-if="item.tokenEstimate" class="token-estimate">
                      ~{{ item.tokenEstimate }}k
                    </span>
                  </div>
                </div>

                <svg
                  class="item-chevron"
                  :class="{ expanded: expandedItemId === item.id }"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path d="M6 9l6 6 6-6"/>
                </svg>
              </div>

              <!-- Expanded edit form -->
              <Transition name="expand">
                <div v-if="expandedItemId === item.id" class="item-edit">
                  <div class="edit-field">
                    <label>Title</label>
                    <input
                      type="text"
                      :value="item.title"
                      @input="updateItem(item, 'title', $event.target.value)"
                    />
                  </div>

                  <div class="edit-field">
                    <label>Description</label>
                    <textarea
                      rows="2"
                      :value="item.description"
                      @input="updateItem(item, 'description', $event.target.value)"
                    ></textarea>
                  </div>

                  <div class="edit-row">
                    <div class="edit-field">
                      <label>Tokens (k)</label>
                      <input
                        type="number"
                        min="1"
                        :value="item.tokenEstimate"
                        @input="updateItem(item, 'tokenEstimate', parseInt($event.target.value) || 1)"
                      />
                    </div>
                    <div class="edit-field">
                      <label>Quarter</label>
                      <select
                        :value="item.quarter"
                        @change="updateItem(item, 'quarter', $event.target.value || null)"
                      >
                        <option v-for="q in quarters" :key="q.value" :value="q.value">
                          {{ q.label }}
                        </option>
                      </select>
                    </div>
                    <div class="edit-field">
                      <label>Status</label>
                      <select
                        :value="item.status"
                        @change="updateItem(item, 'status', $event.target.value)"
                      >
                        <option value="planned">Planned</option>
                        <option value="in-progress">In Progress</option>
                        <option value="done">Done</option>
                      </select>
                    </div>
                  </div>

                  <div class="edit-field">
                    <label>Notes</label>
                    <input
                      type="text"
                      placeholder="Optional notes..."
                      :value="item.notes || ''"
                      @input="updateItem(item, 'notes', $event.target.value || undefined)"
                    />
                  </div>

                  <div class="edit-actions">
                    <button class="btn-delete" @click="deleteItem(item.id, $event)">
                      Delete Item
                    </button>
                    <button class="btn-done" @click="expandedItemId = null">
                      Done
                    </button>
                  </div>
                </div>
              </Transition>
            </div>

            <!-- Add new item form (inline) -->
            <Transition name="expand">
              <div v-if="addingToArea === area" class="add-form">
                <div class="edit-field">
                  <label>Title</label>
                  <input
                    v-model="newItem.title"
                    type="text"
                    placeholder="New item title..."
                  />
                </div>

                <div class="edit-field">
                  <label>Description</label>
                  <textarea
                    v-model="newItem.description"
                    rows="2"
                    placeholder="What needs to be done..."
                  ></textarea>
                </div>

                <div class="edit-row">
                  <div class="edit-field">
                    <label>Tokens (k)</label>
                    <input
                      v-model.number="newItem.tokenEstimate"
                      type="number"
                      min="1"
                    />
                  </div>
                  <div class="edit-field">
                    <label>Quarter</label>
                    <select v-model="newItem.quarter">
                      <option v-for="q in quarters" :key="q.value" :value="q.value">
                        {{ q.label }}
                      </option>
                    </select>
                  </div>
                </div>

                <div class="edit-field">
                  <label>Notes</label>
                  <input
                    v-model="newItem.notes"
                    type="text"
                    placeholder="Optional notes..."
                  />
                </div>

                <div class="edit-actions">
                  <button class="btn-cancel" @click="cancelAdd">Cancel</button>
                  <button
                    class="btn-save"
                    @click="saveNewItem"
                    :disabled="!newItem.title.trim()"
                  >
                    Add Item
                  </button>
                </div>
              </div>
            </Transition>

            <!-- Add item button -->
            <button
              v-if="addingToArea !== area"
              class="add-item-btn"
              @click="startAdding(area)"
            >
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
      <p>Drag to reorder • Click to expand & edit • Auto-saves</p>
    </footer>
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
  padding: 1rem 1.5rem 0.5rem;
}

.stat {
  flex: 1;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 12px;
  padding: 0.625rem;
  text-align: center;
}

.stat-value {
  display: block;
  font-size: 1.25rem;
  font-weight: 700;
  color: #f1f5f9;
  letter-spacing: -0.02em;
}

.stat-label {
  display: block;
  font-size: 0.6rem;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-top: 0.125rem;
}

.stat.tokens {
  background: rgba(167, 139, 250, 0.08);
  border-color: rgba(167, 139, 250, 0.2);
}

.stat.tokens .stat-value {
  color: #a78bfa;
}

/* Quarter bar */
.quarter-bar {
  position: relative;
  z-index: 1;
  display: flex;
  gap: 0.375rem;
  padding: 0.5rem 1.5rem;
}

.quarter-stat {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.5rem;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.04);
  border-radius: 8px;
  font-size: 0.7rem;
}

.quarter-stat.current {
  background: rgba(96, 165, 250, 0.1);
  border-color: rgba(96, 165, 250, 0.3);
}

.q-label {
  font-weight: 600;
  color: #94a3b8;
}

.quarter-stat.current .q-label {
  color: #60a5fa;
}

.q-progress {
  color: #64748b;
}

.q-tokens {
  color: #a78bfa;
  font-size: 0.65rem;
}

/* Progress section */
.progress-section {
  position: relative;
  z-index: 1;
  padding: 0.5rem 1.5rem 1rem;
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
  padding: 0 1rem 6rem;
}

.area-section {
  margin-bottom: 0.5rem;
}

/* 3 Wins section */
.wins-section {
  margin-bottom: 1rem;
}

.wins-header {
  background: rgba(251, 191, 36, 0.08) !important;
  border-color: rgba(251, 191, 36, 0.2) !important;
}

.wins-header .area-label {
  color: #fbbf24 !important;
}

.wins-content {
  padding: 0.75rem;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.04);
  border-radius: 0 0 12px 12px;
  margin-top: -1px;
}

.wins-level {
  margin-bottom: 1rem;
}

.wins-level:last-child {
  margin-bottom: 0;
}

.wins-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8rem;
  font-weight: 600;
  color: #94a3b8;
  margin: 0 0 0.5rem;
}

.wins-icon {
  font-size: 1rem;
}

.wins-list {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.win-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.win-number {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(251, 191, 36, 0.15);
  color: #fbbf24;
  border-radius: 50%;
  font-size: 0.7rem;
  font-weight: 600;
  flex-shrink: 0;
}

.win-input {
  flex: 1;
  padding: 0.5rem 0.625rem;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  color: #f1f5f9;
  font-size: 0.85rem;
  font-family: inherit;
}

.win-input:focus {
  outline: none;
  border-color: #fbbf24;
  background: rgba(251, 191, 36, 0.05);
}

.win-input::placeholder {
  color: #475569;
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

/* Roadmap item */
.roadmap-item {
  margin-bottom: 0.5rem;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.04);
  border-radius: 10px;
  overflow: hidden;
  transition: all 0.2s ease;
}

.roadmap-item:hover {
  background: rgba(255, 255, 255, 0.04);
}

.roadmap-item.expanded {
  border-color: rgba(96, 165, 250, 0.3);
  background: rgba(96, 165, 250, 0.05);
}

.roadmap-item.done {
  opacity: 0.7;
}

.roadmap-item.dragging {
  opacity: 0.5;
  transform: scale(0.98);
}

.roadmap-item.drag-over {
  border-color: #60a5fa;
  background: rgba(96, 165, 250, 0.1);
}

/* Item header */
.item-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  cursor: pointer;
}

.drag-handle {
  width: 16px;
  height: 16px;
  color: #475569;
  cursor: grab;
  flex-shrink: 0;
  opacity: 0.5;
  transition: opacity 0.2s ease;
}

.drag-handle:hover {
  opacity: 1;
  color: #64748b;
}

.drag-handle:active {
  cursor: grabbing;
}

.drag-handle svg {
  width: 100%;
  height: 100%;
}

.status-dot {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px solid;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
  flex-shrink: 0;
}

.status-dot:hover {
  transform: scale(1.1);
}

.dot-inner {
  width: 9px;
  height: 9px;
  border-radius: 50%;
}

.item-summary {
  flex: 1;
  min-width: 0;
}

.item-title {
  font-size: 0.85rem;
  font-weight: 600;
  color: #f1f5f9;
  margin: 0 0 0.2rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.roadmap-item.done .item-title {
  text-decoration: line-through;
  color: #94a3b8;
}

.item-meta {
  display: flex;
  gap: 0.375rem;
  align-items: center;
  flex-wrap: wrap;
}

.status-badge {
  font-size: 0.55rem;
  font-weight: 600;
  padding: 0.125rem 0.35rem;
  border-radius: 4px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.quarter-badge {
  font-size: 0.55rem;
  font-weight: 600;
  padding: 0.125rem 0.35rem;
  border-radius: 4px;
  background: rgba(96, 165, 250, 0.15);
  color: #60a5fa;
}

.token-estimate {
  font-size: 0.65rem;
  color: #a78bfa;
  font-weight: 500;
}

.item-chevron {
  width: 14px;
  height: 14px;
  color: #64748b;
  transition: transform 0.2s ease;
  flex-shrink: 0;
}

.item-chevron.expanded {
  transform: rotate(180deg);
}

/* Item edit section */
.item-edit,
.add-form {
  padding: 0 1rem 1rem;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.add-form {
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 10px;
  padding: 1rem;
  margin-bottom: 0.5rem;
}

.edit-field {
  margin-bottom: 0.625rem;
}

.edit-field label {
  display: block;
  font-size: 0.65rem;
  color: #64748b;
  margin-bottom: 0.2rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.edit-field input,
.edit-field textarea,
.edit-field select {
  width: 100%;
  padding: 0.45rem 0.5rem;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  color: #f1f5f9;
  font-size: 0.8rem;
  font-family: inherit;
}

.edit-field input:focus,
.edit-field textarea:focus,
.edit-field select:focus {
  outline: none;
  border-color: #60a5fa;
}

.edit-field textarea {
  resize: vertical;
  min-height: 45px;
}

.edit-row {
  display: flex;
  gap: 0.5rem;
}

.edit-row .edit-field {
  flex: 1;
}

.edit-actions {
  display: flex;
  justify-content: space-between;
  margin-top: 0.625rem;
  padding-top: 0.625rem;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.btn-delete {
  padding: 0.35rem 0.625rem;
  background: transparent;
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 6px;
  color: #ef4444;
  font-size: 0.7rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-delete:hover {
  background: rgba(239, 68, 68, 0.1);
}

.btn-done,
.btn-save {
  padding: 0.35rem 0.625rem;
  background: #60a5fa;
  border: none;
  border-radius: 6px;
  color: #0a0a0f;
  font-size: 0.7rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-done:hover,
.btn-save:hover {
  background: #3b82f6;
}

.btn-save:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-cancel {
  padding: 0.35rem 0.625rem;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  color: #94a3b8;
  font-size: 0.7rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-cancel:hover {
  background: rgba(255, 255, 255, 0.05);
}

/* Add item button */
.add-item-btn {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.5rem;
  background: transparent;
  border: 1px dashed rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  color: #64748b;
  font-size: 0.75rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.add-item-btn:hover {
  border-color: #60a5fa;
  color: #60a5fa;
  background: rgba(96, 165, 250, 0.05);
}

.add-item-btn svg {
  width: 12px;
  height: 12px;
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

/* Expand animation */
.expand-enter-active,
.expand-leave-active {
  transition: all 0.2s ease;
  overflow: hidden;
}

.expand-enter-from,
.expand-leave-to {
  opacity: 0;
  max-height: 0;
  padding-top: 0;
  padding-bottom: 0;
}

.expand-enter-to,
.expand-leave-from {
  opacity: 1;
  max-height: 500px;
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

  .quarter-bar {
    flex-wrap: wrap;
  }

  .quarter-stat {
    min-width: calc(50% - 0.1875rem);
  }

  .edit-row {
    flex-direction: column;
    gap: 0;
  }

  .wins-list {
    gap: 0.5rem;
  }
}
</style>
