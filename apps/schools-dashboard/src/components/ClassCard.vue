<script setup>
import { computed } from 'vue'

const props = defineProps({
  classData: {
    type: Object,
    required: true
  }
})

const emit = defineEmits(['play', 'viewRoster', 'settings'])

// Course flag mapping
const courseFlags = {
  'cym_for_eng': '\uD83C\uDFF4\uDB40\uDC67\uDB40\uDC62\uDB40\uDC77\uDB40\uDC6C\uDB40\uDC73\uDB40\uDC7F',
  'cym_for_eng_north': '\uD83C\uDFF4\uDB40\uDC67\uDB40\uDC62\uDB40\uDC77\uDB40\uDC6C\uDB40\uDC73\uDB40\uDC7F',
  'cym_for_eng_south': '\uD83C\uDFF4\uDB40\uDC67\uDB40\uDC62\uDB40\uDC77\uDB40\uDC6C\uDB40\uDC73\uDB40\uDC7F',
  'spa_for_eng': '\uD83C\uDDEA\uD83C\uDDF8',
  'spa_for_eng_latam': '\uD83C\uDDEA\uD83C\uDDF8',
  'nld_for_eng': '\uD83C\uDDF3\uD83C\uDDF1',
  'cor_for_eng': '\uD83C\uDFF4\uDB40\uDC67\uDB40\uDC62\uDB40\uDC65\uDB40\uDC6E\uDB40\uDC67\uDB40\uDC7F',
  'glv_for_eng': '\uD83C\uDDEE\uD83C\uDDF2'
}

const courseNames = {
  'cym_for_eng': 'Welsh',
  'cym_for_eng_north': 'Welsh (Northern)',
  'cym_for_eng_south': 'Welsh (Southern)',
  'spa_for_eng': 'Spanish',
  'spa_for_eng_latam': 'Spanish (Latin Am.)',
  'nld_for_eng': 'Dutch',
  'cor_for_eng': 'Cornish',
  'glv_for_eng': 'Manx'
}

const courseFlag = computed(() => {
  return courseFlags[props.classData.course_code] || '\uD83C\uDF10'
})

const courseName = computed(() => {
  return courseNames[props.classData.course_code] || props.classData.course_code
})

const handlePlay = () => {
  emit('play', props.classData)
}

const handleViewRoster = () => {
  emit('viewRoster', props.classData)
}

const handleSettings = () => {
  emit('settings', props.classData)
}
</script>

<template>
  <article class="class-card">
    <!-- Top accent bar -->
    <div class="card-accent"></div>

    <div class="card-content">
      <!-- Header with name and course badge -->
      <header class="card-header">
        <div class="class-info">
          <h3 class="class-name">{{ classData.class_name }}</h3>
          <div class="class-meta">
            <span class="meta-item">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6"/>
              </svg>
              {{ classData.student_count || 0 }} students
            </span>
          </div>
        </div>
        <div class="course-badge">
          <span class="course-flag">{{ courseFlag }}</span>
          <span class="course-name">{{ courseName }}</span>
        </div>
      </header>

      <!-- Stats grid -->
      <div class="stats-grid">
        <div class="stat-item">
          <span class="stat-value">{{ classData.current_seed || 1 }}</span>
          <span class="stat-label">Position</span>
        </div>
        <div class="stat-item">
          <span class="stat-value">{{ classData.sessions || 0 }}</span>
          <span class="stat-label">Sessions</span>
        </div>
        <div class="stat-item">
          <span class="stat-value">{{ classData.total_time || '0h' }}</span>
          <span class="stat-label">Total Time</span>
        </div>
      </div>

      <!-- Actions -->
      <div class="card-actions">
        <button class="btn-play" @click="handlePlay">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <polygon points="5 3 19 12 5 21 5 3"/>
          </svg>
          <span>Play as Class</span>
        </button>
        <button class="btn-roster" @click="handleViewRoster" title="View roster">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
            <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
        </button>
        <button class="btn-settings" @click="handleSettings" title="Class settings">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="3"/>
            <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/>
          </svg>
        </button>
      </div>

      <!-- Last activity indicator -->
      <div class="last-activity" :class="{ recent: classData.last_played_recently }">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
        </svg>
        <span>{{ classData.last_played || 'Never played' }}</span>
      </div>
    </div>
  </article>
</template>

<style scoped>
.class-card {
  background: var(--bg-card, #242424);
  border: 1px solid var(--border-subtle, rgba(255,255,255,0.08));
  border-radius: 16px;
  position: relative;
  overflow: hidden;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.class-card:hover {
  border-color: var(--ssi-red, #c23a3a);
  transform: translateY(-4px);
  box-shadow:
    0 12px 40px rgba(0,0,0,0.4),
    0 0 0 1px rgba(194, 58, 58, 0.2);
}

.card-accent {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 4px;
  background: linear-gradient(90deg, var(--ssi-red, #c23a3a), var(--ssi-gold, #d4a853));
  opacity: 0;
  transition: opacity 0.3s ease;
}

.class-card:hover .card-accent {
  opacity: 1;
}

.card-content {
  padding: 24px;
}

.card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}

.class-info {
  flex: 1;
  min-width: 0;
}

.class-name {
  font-family: 'Noto Sans JP', 'DM Sans', sans-serif;
  font-size: 1.125rem;
  font-weight: 700;
  color: var(--text-primary, #ffffff);
  margin: 0 0 6px 0;
  line-height: 1.3;
}

.class-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 0.8125rem;
  color: var(--text-secondary, #b0b0b0);
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.meta-item svg {
  opacity: 0.7;
}

.course-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: var(--bg-secondary, #1a1a1a);
  border-radius: 8px;
  flex-shrink: 0;
}

.course-flag {
  font-size: 1rem;
}

.course-name {
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--text-primary, #ffffff);
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  padding: 16px;
  background: var(--bg-secondary, #1a1a1a);
  border-radius: 12px;
  margin-bottom: 20px;
}

.stat-item {
  text-align: center;
}

.stat-value {
  display: block;
  font-family: 'Noto Sans JP', 'DM Sans', sans-serif;
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--ssi-gold, #d4a853);
  line-height: 1.2;
}

.stat-label {
  display: block;
  font-size: 0.6875rem;
  color: var(--text-muted, #707070);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-top: 2px;
}

.card-actions {
  display: flex;
  gap: 10px;
}

.btn-play {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 14px 24px;
  background: linear-gradient(135deg, var(--ssi-red, #c23a3a), var(--ssi-red-dark, #9a2e2e));
  color: white;
  border: none;
  border-radius: 12px;
  font-family: inherit;
  font-size: 0.9375rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 4px 15px rgba(194, 58, 58, 0.35);
  min-height: 48px;
}

.btn-play:hover {
  transform: translateY(-2px) scale(1.02);
  box-shadow: 0 6px 20px rgba(194, 58, 58, 0.5);
}

.btn-play:active {
  transform: translateY(0) scale(0.98);
}

.btn-play svg {
  width: 18px;
  height: 18px;
}

.btn-roster,
.btn-settings {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  background: var(--bg-card, #242424);
  border: 1px solid var(--border-medium, rgba(255,255,255,0.15));
  border-radius: 12px;
  color: var(--text-secondary, #b0b0b0);
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-roster:hover,
.btn-settings:hover {
  background: var(--bg-elevated, #333333);
  border-color: var(--ssi-red, #c23a3a);
  color: var(--text-primary, #ffffff);
}

.last-activity {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.75rem;
  color: var(--text-muted, #707070);
  margin-top: 12px;
}

.last-activity.recent {
  color: var(--success, #4ade80);
}

.last-activity svg {
  opacity: 0.8;
}

/* Responsive touch targets */
@media (max-width: 768px) {
  .btn-play {
    padding: 16px 20px;
    min-height: 52px;
  }

  .btn-roster,
  .btn-settings {
    width: 52px;
    height: 52px;
  }
}
</style>
