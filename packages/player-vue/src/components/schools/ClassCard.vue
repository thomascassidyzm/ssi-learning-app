<script setup>
import { computed } from 'vue'
import LanguageFlag from '@/components/schools/shared/LanguageFlag.vue'

const props = defineProps({
  classData: {
    type: Object,
    required: true
  }
})

const emit = defineEmits(['play', 'viewRoster', 'settings'])

const courseNames = {
  'cym_for_eng': 'Welsh',
  'cym_for_eng_north': 'Welsh (Northern)',
  'cym_for_eng_south': 'Welsh (Southern)',
  'cym_n_for_eng': 'Welsh (Northern)',
  'cym_s_for_eng': 'Welsh (Southern)',
  'spa_for_eng': 'Spanish',
  'spa_for_eng_latam': 'Spanish (Latin Am.)',
  'eng_for_spa': 'English',
  'fra_for_eng': 'French',
  'deu_for_eng': 'German',
  'nld_for_eng': 'Dutch',
  'gle_for_eng': 'Irish',
  'jpn_for_eng': 'Japanese',
  'eng_for_jpn': 'English',
  'cmn_for_eng': 'Chinese',
  'ara_for_eng': 'Arabic',
  'kor_for_eng': 'Korean',
  'ita_for_eng': 'Italian',
  'por_for_eng': 'Portuguese',
  'bre_for_fre': 'Breton',
  'cor_for_eng': 'Cornish',
  'glv_for_eng': 'Manx',
  'eus_for_spa': 'Basque',
  'cat_for_spa': 'Catalan',
  'gla_for_eng': 'Scottish Gaelic',
  'rus_for_eng': 'Russian',
  'pol_for_eng': 'Polish'
}

const courseName = computed(() => {
  return courseNames[props.classData.course_code] || props.classData.course_code
})

// Belt logic: compute from current_seed
const beltThresholds = [
  { name: 'Black', min: 400, color: 'var(--belt-black, #2C2622)', bg: 'rgba(44, 38, 34, 0.12)', textColor: '#2C2622' },
  { name: 'Brown', min: 280, color: 'var(--belt-brown, #8b6914)', bg: 'rgba(139, 105, 20, 0.12)', textColor: '#8b6914' },
  { name: 'Purple', min: 150, color: 'var(--belt-purple, #9b51e0)', bg: 'rgba(155, 81, 224, 0.10)', textColor: '#8040c0' },
  { name: 'Blue', min: 80, color: 'var(--belt-blue, #2d9cdb)', bg: 'rgba(45, 156, 219, 0.12)', textColor: '#2d9cdb' },
  { name: 'Green', min: 40, color: 'var(--belt-green, #27ae60)', bg: 'rgba(39, 174, 96, 0.12)', textColor: '#1a7a3a' },
  { name: 'Orange', min: 20, color: 'var(--belt-orange, #f2994a)', bg: 'rgba(242, 153, 74, 0.12)', textColor: '#c27830' },
  { name: 'Yellow', min: 8, color: 'var(--belt-yellow, #f2c94c)', bg: 'rgba(242, 201, 76, 0.15)', textColor: '#b8941a' },
  { name: 'White', min: 0, color: 'var(--belt-white, #e8e3dd)', bg: 'rgba(232, 227, 221, 0.15)', textColor: '#8A8078' },
]

const currentBelt = computed(() => {
  const seed = props.classData.current_seed || 0
  return beltThresholds.find(b => seed >= b.min) || beltThresholds[beltThresholds.length - 1]
})

// Journey progress
const currentSeed = computed(() => props.classData.current_seed || 1)
const totalSeeds = 300
const journeyPercent = computed(() => Math.min(100, (currentSeed.value / totalSeeds) * 100))

// Benchmark data
const hasBenchmark = computed(() => {
  const d = props.classData
  return d.total_cycles && d.total_cycles > 0
})

const benchmarkValues = computed(() => {
  if (!hasBenchmark.value) return null
  const classCycles = props.classData.total_cycles || 0
  const schoolCycles = props.classData.school_avg_cycles || 0
  const regionCycles = props.classData.region_avg_cycles || 0
  const courseCycles = props.classData.course_avg_cycles || 0
  const max = Math.max(classCycles, schoolCycles, regionCycles, courseCycles, 1)
  return {
    classCycles,
    schoolCycles,
    regionCycles,
    courseCycles,
    classPercent: (classCycles / max) * 100,
    schoolPercent: (schoolCycles / max) * 100,
    regionPercent: (regionCycles / max) * 100,
    coursePercent: (courseCycles / max) * 100,
  }
})

// Stats
const totalSessions = computed(() => props.classData.total_sessions || 0)
const totalTime = computed(() => {
  const secs = props.classData.total_practice_seconds || 0
  if (secs === 0) return '0h'
  const hours = secs / 3600
  if (hours >= 1) return hours.toFixed(1) + 'h'
  return Math.round(secs / 60) + 'm'
})
const avgPerSession = computed(() => {
  const avg = props.classData.avg_cycles_per_session
  if (!avg) return '0'
  return Math.round(avg).toString()
})

// Last session time
const lastSessionText = computed(() => {
  const created = props.classData.created_at
  if (!created) return ''
  // For now, use created_at as a proxy; real last session would come from reports
  return ''
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
    <div class="card-content">
      <!-- Header: flag + name + meta -->
      <header class="card-header">
        <div class="card-flag">
          <LanguageFlag :code="classData.course_code" :size="52" />
        </div>
        <div class="card-identity">
          <div class="card-class-name">{{ classData.class_name }}</div>
          <div class="card-course-name">
            <span>{{ courseName }}</span>
            <span class="separator">·</span>
            <span class="card-students">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6"/>
              </svg>
              {{ classData.student_count || 0 }}
            </span>
          </div>
        </div>
        <div class="card-meta">
          <span
            class="card-belt-badge"
            :style="{ background: currentBelt.bg, color: currentBelt.textColor }"
          >
            <span
              class="belt-dot"
              :style="{ background: currentBelt.color }"
            ></span>
            {{ currentBelt.name }} Belt
          </span>
          <span v-if="lastSessionText" class="card-last-session">{{ lastSessionText }}</span>
        </div>
      </header>

      <!-- Journey progress -->
      <div class="journey-section">
        <div class="journey-label">
          <span class="journey-label-text">Course Journey</span>
          <span class="journey-label-value">Seed {{ currentSeed }} of {{ totalSeeds }}</span>
        </div>
        <div class="journey-track">
          <div
            class="journey-fill"
            :style="{ width: journeyPercent + '%', background: currentBelt.color }"
          ></div>
        </div>
      </div>

      <!-- Benchmark section -->
      <div v-if="hasBenchmark && benchmarkValues" class="benchmark-section">
        <div class="benchmark-title">Speaking Opportunities</div>
        <div class="benchmark-track-container">
          <div class="benchmark-track">
            <div
              class="benchmark-fill"
              :style="{ width: benchmarkValues.classPercent + '%' }"
            ></div>
            <div
              v-if="benchmarkValues.courseCycles > 0"
              class="benchmark-marker marker-global"
              :style="{ left: benchmarkValues.coursePercent + '%' }"
              :title="'Global avg: ' + benchmarkValues.courseCycles"
            ></div>
            <div
              v-if="benchmarkValues.regionCycles > 0"
              class="benchmark-marker marker-region"
              :style="{ left: benchmarkValues.regionPercent + '%' }"
              :title="'Regional avg: ' + benchmarkValues.regionCycles"
            ></div>
            <div
              v-if="benchmarkValues.schoolCycles > 0"
              class="benchmark-marker marker-school"
              :style="{ left: benchmarkValues.schoolPercent + '%' }"
              :title="'School avg: ' + benchmarkValues.schoolCycles"
            ></div>
            <div
              class="benchmark-marker marker-class"
              :style="{ left: benchmarkValues.classPercent + '%' }"
              :title="'This class: ' + benchmarkValues.classCycles"
            ></div>
          </div>
        </div>
        <div class="benchmark-legend">
          <div class="legend-item legend-class">
            <span class="legend-dot dot-class"></span>
            <span>This class</span>
            <span class="legend-value">{{ benchmarkValues.classCycles }}</span>
          </div>
          <div v-if="benchmarkValues.schoolCycles > 0" class="legend-item">
            <span class="legend-dot dot-school"></span>
            <span>School</span>
            <span class="legend-value">{{ benchmarkValues.schoolCycles }}</span>
          </div>
          <div v-if="benchmarkValues.regionCycles > 0" class="legend-item">
            <span class="legend-dot dot-region"></span>
            <span>Region</span>
            <span class="legend-value">{{ benchmarkValues.regionCycles }}</span>
          </div>
          <div v-if="benchmarkValues.courseCycles > 0" class="legend-item">
            <span class="legend-dot dot-global"></span>
            <span>Global</span>
            <span class="legend-value">{{ benchmarkValues.courseCycles }}</span>
          </div>
        </div>
      </div>

      <!-- Stats row -->
      <div v-if="hasBenchmark" class="stats-row">
        <div class="stat-cell">
          <div class="stat-value">{{ totalSessions }}</div>
          <div class="stat-label">Sessions</div>
        </div>
        <div class="stat-cell">
          <div class="stat-value">{{ totalTime }}</div>
          <div class="stat-label">Total Time</div>
        </div>
        <div class="stat-cell">
          <div class="stat-value">{{ avgPerSession }}</div>
          <div class="stat-label">Avg / Session</div>
        </div>
      </div>

      <!-- Play button -->
      <button class="play-button" @click="handlePlay">
        <span class="play-icon">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="white">
            <polygon points="2,0 12,6 2,12"/>
          </svg>
        </span>
        Play as Class
      </button>
    </div>
  </article>
</template>

<style scoped>
.class-card {
  background: var(--bg-card, #ffffff);
  border: 1px solid var(--border-subtle, rgba(44, 38, 34, 0.06));
  border-radius: var(--radius-lg, 20px);
  box-shadow: var(--shadow-card, 0 1px 3px rgba(44, 38, 34, 0.06), 0 6px 16px rgba(44, 38, 34, 0.04));
  transition: box-shadow 0.3s ease, transform 0.3s ease, border-color 0.3s ease;
}

.class-card:hover {
  box-shadow: var(--shadow-card-hover, 0 2px 8px rgba(44, 38, 34, 0.08), 0 12px 28px rgba(44, 38, 34, 0.06));
  transform: translateY(-2px);
  border-color: var(--border-medium, rgba(44, 38, 34, 0.10));
}

.card-content {
  padding: 28px;
}

/* Card header: flag + name + meta */
.card-header {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 22px;
}

.card-flag {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  overflow: hidden;
  flex-shrink: 0;
  box-shadow: 0 2px 8px rgba(0,0,0,0.10);
  display: flex;
  align-items: center;
  justify-content: center;
}

.card-flag :deep(.language-flag) {
  width: 52px !important;
  height: 52px !important;
}

.card-identity {
  flex: 1;
  min-width: 0;
}

.card-class-name {
  font-family: var(--font-display, 'Fraunces', serif);
  font-size: 1.3rem;
  font-weight: 600;
  color: var(--text-primary, #2C2622);
  letter-spacing: -0.01em;
  line-height: 1.2;
}

.card-course-name {
  font-size: 0.8125rem;
  color: var(--text-muted, #8A8078);
  margin-top: 3px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.separator {
  color: var(--text-faint, #b5aea6);
}

.card-students {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.8125rem;
  color: var(--text-muted, #8A8078);
}

.card-students svg {
  opacity: 0.5;
}

.card-meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  flex-shrink: 0;
}

.card-belt-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border-radius: 100px;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}

.belt-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  display: inline-block;
}

.card-last-session {
  font-size: 0.6875rem;
  color: var(--text-faint, #b5aea6);
}

/* Journey progress (belt track) */
.journey-section {
  margin-bottom: 22px;
}

.journey-label {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 8px;
}

.journey-label-text {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-muted, #8A8078);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.journey-label-value {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-secondary, #5a524a);
}

.journey-track {
  position: relative;
  height: 8px;
  background: var(--bg-track, #e8e3dd);
  border-radius: 4px;
  overflow: hidden;
}

.journey-fill {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  border-radius: 4px;
  transition: width 1s ease;
}

/* Benchmarking section */
.benchmark-section {
  margin-bottom: 24px;
  padding: 18px;
  background: var(--bg-primary, #f5f0eb);
  border-radius: var(--radius-md, 14px);
}

.benchmark-title {
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--text-muted, #8A8078);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 14px;
}

.benchmark-track-container {
  position: relative;
  margin-bottom: 6px;
}

.benchmark-track {
  position: relative;
  height: 32px;
  background: var(--bg-track, #e8e3dd);
  border-radius: 6px;
  overflow: visible;
}

.benchmark-fill {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  background: var(--ssi-red, #c23a3a);
  border-radius: 6px;
  opacity: 0.12;
}

/* Marker lines on the benchmark track */
.benchmark-marker {
  position: absolute;
  top: -4px;
  width: 2px;
  height: 40px;
  border-radius: 1px;
  transform: translateX(-1px);
  z-index: 2;
}

.benchmark-marker.marker-class {
  width: 4px;
  height: 44px;
  top: -6px;
  background: var(--ssi-red, #c23a3a);
  border-radius: 2px;
  transform: translateX(-2px);
  z-index: 3;
  box-shadow: 0 0 8px rgba(194, 58, 58, 0.3);
}

.benchmark-marker.marker-school {
  background: var(--text-muted, #8A8078);
  opacity: 0.5;
}

.benchmark-marker.marker-region {
  background: var(--belt-blue, #2d9cdb);
  opacity: 0.5;
}

.benchmark-marker.marker-global {
  background: var(--belt-green, #27ae60);
  opacity: 0.4;
}

/* Marker dot */
.benchmark-marker::after {
  content: '';
  position: absolute;
  bottom: -4px;
  left: 50%;
  transform: translateX(-50%);
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: inherit;
  opacity: 1;
}

.benchmark-marker.marker-class::after {
  width: 8px;
  height: 8px;
  background: var(--ssi-red, #c23a3a);
  box-shadow: 0 0 6px rgba(194, 58, 58, 0.4);
}

/* Legend */
.benchmark-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  margin-top: 12px;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.6875rem;
  color: var(--text-muted, #8A8078);
}

.legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.legend-dot.dot-class { background: var(--ssi-red, #c23a3a); }
.legend-dot.dot-school { background: var(--text-muted, #8A8078); opacity: 0.5; }
.legend-dot.dot-region { background: var(--belt-blue, #2d9cdb); opacity: 0.5; }
.legend-dot.dot-global { background: var(--belt-green, #27ae60); opacity: 0.4; }

.legend-value {
  font-weight: 600;
  color: var(--text-secondary, #5a524a);
}

.legend-item.legend-class .legend-value {
  color: var(--ssi-red, #c23a3a);
  font-weight: 700;
}

/* Stats row */
.stats-row {
  display: flex;
  gap: 1px;
  margin-bottom: 24px;
  background: var(--border-subtle, rgba(44, 38, 34, 0.06));
  border-radius: var(--radius-sm, 8px);
  overflow: hidden;
}

.stat-cell {
  flex: 1;
  padding: 12px 14px;
  background: var(--bg-card, #ffffff);
  text-align: center;
}

.stat-cell:first-child {
  border-radius: var(--radius-sm, 8px) 0 0 var(--radius-sm, 8px);
}

.stat-cell:last-child {
  border-radius: 0 var(--radius-sm, 8px) var(--radius-sm, 8px) 0;
}

.stat-value {
  font-family: var(--font-display, 'Fraunces', serif);
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text-primary, #2C2622);
  line-height: 1;
  margin-bottom: 4px;
}

.stat-label {
  font-size: 0.6875rem;
  color: var(--text-faint, #b5aea6);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

/* Play button */
.play-button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  width: 100%;
  padding: 16px 24px;
  background: var(--ssi-red, #c23a3a);
  color: #fff;
  border: none;
  border-radius: var(--radius-md, 14px);
  font-family: var(--font-body, 'DM Sans', sans-serif);
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s, box-shadow 0.2s, transform 0.15s;
  box-shadow: 0 2px 8px rgba(194, 58, 58, 0.25);
  letter-spacing: 0.01em;
}

.play-button:hover {
  background: var(--ssi-red-hover, #a83232);
  transform: translateY(-1px);
  box-shadow: 0 4px 14px rgba(194, 58, 58, 0.35);
}

.play-button:active {
  transform: translateY(0);
  box-shadow: 0 1px 4px rgba(194, 58, 58, 0.2);
}

.play-icon {
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255,255,255,0.2);
  border-radius: 50%;
  flex-shrink: 0;
}

.play-icon svg {
  margin-left: 2px;
}

/* Responsive */
@media (max-width: 560px) {
  .card-content {
    padding: 22px;
  }

  .card-flag {
    width: 44px;
    height: 44px;
  }

  .card-flag :deep(.language-flag) {
    width: 44px !important;
    height: 44px !important;
  }

  .card-class-name {
    font-size: 1.1rem;
  }

  .benchmark-legend {
    gap: 8px;
  }

  .stats-row {
    flex-wrap: wrap;
  }

  .stat-cell {
    flex: 1 1 calc(50% - 1px);
  }

  .play-button {
    padding: 14px 20px;
    font-size: 0.9375rem;
  }
}
</style>
