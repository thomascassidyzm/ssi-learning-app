<script setup>
/**
 * LegoNetwork.vue - D3 Force-Directed Graph Visualization
 *
 * Visualizes the learner's LEGO network as an organic, growing constellation.
 * Each node is a LEGO, edges are transitions (practice sequences).
 *
 * Visual encoding:
 * - Node brightness = mastery level (more reps = brighter)
 * - Edge thickness = transition frequency
 * - Ambient palette = current belt level
 * - No forced clustering - natural groupings emerge from practice patterns
 *
 * Demo Mode:
 * - Simulates learning journey growth over rounds
 * - Milestones at 50, 100, 150 rounds etc.
 * - Adjustable speed controls (1x, 2x, 4x, 8x)
 * - Watch the network grow organically
 */

import { ref, computed, inject, onMounted, onUnmounted, watch, nextTick } from 'vue'
import * as d3 from 'd3'
import { useLegoNetwork } from '../composables/useLegoNetwork'
import { generateLearningScript } from '../providers/CourseDataProvider'
import { getCachedScript } from '../composables/useScriptCache'

// ============================================================================
// Simple audio controller (same as CourseExplorer)
// ============================================================================
class ScriptAudioController {
  constructor() {
    this.audio = null
  }

  async play(audioRef) {
    if (!audioRef?.url) {
      console.warn('[ScriptAudioController] No audio URL provided')
      return
    }

    if (!this.audio) {
      this.audio = new Audio()
    }

    this.audio.src = audioRef.url
    this.audio.load()

    return new Promise((resolve, reject) => {
      const onEnded = () => {
        this.audio.removeEventListener('ended', onEnded)
        this.audio.removeEventListener('error', onError)
        resolve()
      }

      const onError = (e) => {
        console.error('[ScriptAudioController] Playback error:', e)
        this.audio.removeEventListener('ended', onEnded)
        this.audio.removeEventListener('error', onError)
        reject(e)
      }

      this.audio.addEventListener('ended', onEnded)
      this.audio.addEventListener('error', onError)

      this.audio.play().catch((e) => {
        console.error('[ScriptAudioController] Play failed:', e)
        onError(e)
      })
    })
  }

  stop() {
    if (this.audio) {
      this.audio.pause()
      this.audio.currentTime = 0
    }
  }
}

const emit = defineEmits(['close', 'playbackEnded'])

const props = defineProps({
  course: {
    type: Object,
    default: null
  },
  beltLevel: {
    type: String,
    default: 'white' // white, yellow, orange, green, blue, purple, brown, black
  },
  mode: {
    type: String,
    default: 'auto' // 'auto' | 'demo' | 'real' - auto tries real first, falls back to demo
  }
})

// Inject providers
const supabase = inject('supabase', null)
const auth = inject('auth', null)
const progressStore = inject('progressStore', null)
const courseDataProvider = inject('courseDataProvider', { value: null })

// Use the LEGO network composable for real data
const {
  isLoading: networkLoading,
  error: networkError,
  networkData,
  loadNetworkData: loadRealNetworkData,
  getLegoConnections,
  getPhrasesForLego
} = useLegoNetwork(supabase)

// State
const isLoading = ref(true)
const error = ref(null)
const isRealData = ref(false) // true if showing learner's actual progress
const learnerProgress = ref([]) // LEGOs the learner has practiced

// Full network data (for simulation)
const fullNetworkData = ref(null)

// Graph data
const nodes = ref([])
const links = ref([])
const totalPractices = ref(0)

// All available LEGOs for simulation (not yet in network)
const allAvailableLegos = ref([])

// D3 elements
const containerRef = ref(null)
const svgRef = ref(null)
let simulation = null
let svg = null
let zoomGroup = null
let linksLayer = null
let nodesLayer = null
let labelsLayer = null
let zoomBehavior = null
const currentZoom = ref(1)

// UI state
const selectedNode = ref(null)
const hoveredNode = ref(null)
const isPanelOpen = ref(false)

// Audio
const audioController = ref(null)
const isPlayingAudio = ref(false)

// Phrase practice state
const selectedNodePhrases = ref([]) // Phrases containing the selected LEGO
const isPracticingPhrases = ref(false) // True when auto-playing through phrases
const currentPhraseIndex = ref(0) // Current phrase being practiced
const currentPracticingPhrase = ref(null) // The phrase currently being practiced

// ============================================================================
// REPLAY MODE STATE
// Learning happens in LearningPlayer.vue. LegoNetwork is for replay visualization.
// ============================================================================
const isPlaybackLoading = ref(false)
const playbackQueue = ref([]) // All flat items for the session
const playbackIndex = ref(0) // Current position in queue
const introducedLegoIds = ref(new Set()) // LEGOs that have been introduced

// Path animation state (for future phrase path highlighting)
const pathAnimationIds = ref([]) // LEGO IDs in the current path animation
const pathAnimationActive = ref(false) // True when path animation is running
let pathAnimationTimers = [] // Timers for path animation sequence

// Audio S3 base URL
const AUDIO_S3_BASE_URL = 'https://ssi-audio-stage.s3.eu-west-1.amazonaws.com/mastered'

// ============================================================================
// VISUALIZATION CONFIG - All tunable parameters in one place
// ============================================================================
const VIZ_CONFIG = {
  // Node sizing (base values, multiplied by heroNodeScale)
  node: {
    glowRadius: 18,      // Outer glow circle
    coreRadius: 12,      // Main node circle
    innerRadius: 4,      // Center dot
    eternalRadius: 2,    // Eternal indicator dot
    eternalOffset: -16,  // Y offset for eternal indicator
    strokeWidth: 1.5,    // Normal stroke
    strokeWidthEternal: 2.5, // Eternal node stroke
  },

  // Hero scaling thresholds (fewer nodes = bigger nodes)
  heroScale: {
    threshold1: 3,   // 1-3 nodes
    scale1: 2.5,     // Hero size
    threshold2: 8,   // 4-8 nodes
    scale2: 1.8,     // Large
    threshold3: 15,  // 9-15 nodes
    scale3: 1.3,     // Medium
    scaleDefault: 1, // 16+ nodes - normal
  },

  // Force simulation
  forces: {
    linkDistance: 120,     // Space between connected nodes
    linkStrength: 0.3,     // How strongly links pull
    chargeStrength: -400,  // Node repulsion (negative = repel)
    chargeDistanceMax: 500,// Max repulsion range
    collisionRadius: 35,   // Base collision radius
    centeringStrength: 0.015, // Pull toward center
  },

  // Animation timing (ms)
  timing: {
    nodeEnter: 300,        // New node fade in
    nodeExit: 200,         // Node removal
    labelFade: 200,        // Label opacity changes
    pathStepDelay: 150,    // Delay between path animation steps
    zoomTransition: 300,   // Zoom in/out transitions
    introDisplay: 1500,    // How long to show intro overlay
    linkEnter: 300,        // New link fade in
  },

  // Semantic zoom thresholds
  zoom: {
    min: 0.3,              // Minimum zoom level
    max: 4,                // Maximum zoom level
    labelThreshold: 0.8,   // Show labels above this zoom
    labelFadeRange: 0.3,   // Fade in over this range
  },

  // Atmosphere (empty/early state)
  atmosphere: {
    particleCount: 20,     // Number of ambient particles
    fadeThreshold: 15,     // Nodes before atmosphere fades
    earlyStateMax: 5,      // Show "X LEGOs learned" badge up to this
  },
}

// Replay state (simplified from deprecated demo/learning modes)
const lastAddedNode = ref(null)

// DEPRECATED: Demo simulation state (kept for backwards compatibility, will be removed)
const isDemoRunning = ref(false) // Always false - demo mode deprecated
const currentRound = ref(0)
const demoSpeed = ref(1)
const maxRounds = ref(300)
let demoInterval = null
const milestones = [50, 100, 150, 200, 250, 300]
const reachedMilestones = ref([])

// Belt color palettes - 8 main belts, no stripes
const beltPalettes = {
  white: {
    name: 'White Belt',
    node: { base: '#ffffff15', mid: '#ffffff30', bright: '#ffffff60' },
    glow: '#ffffff',
    link: { base: '#ffffff40', active: '#ffffff70' },
    accent: '#ffffff',
    background: 'radial-gradient(ellipse at 30% 20%, rgba(255,255,255,0.02) 0%, transparent 50%)',
  },
  yellow: {
    name: 'Yellow Belt',
    node: { base: '#fbbf2415', mid: '#fbbf2435', bright: '#fbbf2470' },
    glow: '#fbbf24',
    link: { base: '#fbbf2440', active: '#fbbf2480' },
    accent: '#fbbf24',
    background: 'radial-gradient(ellipse at 30% 20%, rgba(251,191,36,0.03) 0%, transparent 50%)',
  },
  orange: {
    name: 'Orange Belt',
    node: { base: '#f9731615', mid: '#f9731640', bright: '#f9731680' },
    glow: '#f97316',
    link: { base: '#f9731640', active: '#f9731680' },
    accent: '#f97316',
    background: 'radial-gradient(ellipse at 30% 20%, rgba(249,115,22,0.03) 0%, transparent 50%)',
  },
  green: {
    name: 'Green Belt',
    node: { base: '#22c55e15', mid: '#22c55e40', bright: '#22c55e80' },
    glow: '#22c55e',
    link: { base: '#22c55e40', active: '#22c55e80' },
    accent: '#22c55e',
    background: 'radial-gradient(ellipse at 30% 20%, rgba(34,197,94,0.03) 0%, transparent 50%)',
  },
  blue: {
    name: 'Blue Belt',
    node: { base: '#3b82f615', mid: '#3b82f640', bright: '#3b82f680' },
    glow: '#3b82f6',
    link: { base: '#3b82f640', active: '#3b82f680' },
    accent: '#3b82f6',
    background: 'radial-gradient(ellipse at 30% 20%, rgba(59,130,246,0.03) 0%, transparent 50%)',
  },
  purple: {
    name: 'Purple Belt',
    node: { base: '#8b5cf615', mid: '#8b5cf640', bright: '#8b5cf680' },
    glow: '#8b5cf6',
    link: { base: '#8b5cf640', active: '#8b5cf680' },
    accent: '#8b5cf6',
    background: 'radial-gradient(ellipse at 30% 20%, rgba(139,92,246,0.03) 0%, transparent 50%)',
  },
  brown: {
    name: 'Brown Belt',
    node: { base: '#92400e15', mid: '#92400e40', bright: '#92400e80' },
    glow: '#b45309',
    link: { base: '#b4530940', active: '#b4530980' },
    accent: '#b45309',
    background: 'radial-gradient(ellipse at 30% 20%, rgba(146,64,14,0.03) 0%, transparent 50%)',
  },
  black: {
    name: 'Black Belt',
    node: { base: '#1f293720', mid: '#374151', bright: '#4b5563' },
    glow: '#d4a853',
    link: { base: '#d4a85340', active: '#d4a85380' },
    accent: '#d4a853',
    background: 'radial-gradient(ellipse at 30% 20%, rgba(212,168,83,0.04) 0%, transparent 50%)',
  },
}

// Calculate current belt based on node count
// Belt thresholds based on LEGO count (approx 2-3 LEGOs per seed)
const currentBelt = computed(() => {
  const legoCount = nodes.value.length
  // Belt thresholds (based on LEGO count, roughly 2x seed thresholds)
  if (legoCount >= 800) return 'black'   // ~400 seeds
  if (legoCount >= 560) return 'brown'   // ~280 seeds
  if (legoCount >= 300) return 'purple'  // ~150 seeds
  if (legoCount >= 160) return 'blue'    // ~80 seeds
  if (legoCount >= 80) return 'green'    // ~40 seeds
  if (legoCount >= 40) return 'orange'   // ~20 seeds
  if (legoCount >= 16) return 'yellow'   // ~8 seeds
  return 'white'
})

const currentPalette = computed(() => beltPalettes[currentBelt.value] || beltPalettes.white)

// Get palette for a specific belt (used for node birth colors)
const getPalette = (belt) => beltPalettes[belt] || beltPalettes.white

const courseName = computed(() => props.course?.display_name || props.course?.title || 'Course')
const courseCode = computed(() => props.course?.course_code || '')

// Stats
const legoCount = computed(() => nodes.value.length)
const practiceCount = computed(() => totalPractices.value)
const masteredCount = computed(() => nodes.value.filter(n => n.isEternal).length)

// Track current transform for tooltip positioning
const currentTransform = ref({ x: 0, y: 0, k: 1 })

// Tooltip position accounting for zoom/pan
const tooltipPosition = computed(() => {
  if (!hoveredNode.value) return { left: '0px', top: '0px' }
  const t = currentTransform.value
  // Transform node coordinates to screen space
  const screenX = hoveredNode.value.x * t.k + t.x + 20
  const screenY = hoveredNode.value.y * t.k + t.y - 10
  return {
    left: `${screenX}px`,
    top: `${screenY}px`
  }
})

// Hero scaling for early nodes - fewer nodes = bigger size
const heroNodeScale = computed(() => {
  const count = nodes.value.length
  const hs = VIZ_CONFIG.heroScale
  if (count === 0) return hs.scaleDefault
  if (count <= hs.threshold1) return hs.scale1
  if (count <= hs.threshold2) return hs.scale2
  if (count <= hs.threshold3) return hs.scale3
  return hs.scaleDefault
})

// Ambient particle positioning (deterministic based on index)
const getParticleStyle = (index) => {
  const seed = index * 137.508 // Golden angle for distribution
  const x = (seed * 3.14159) % 100
  const y = (seed * 2.71828) % 100
  const delay = (index * 0.3) % 5
  const duration = 3 + (index % 4)
  const size = 2 + (index % 3)
  const opacity = 0.2 + (index % 5) * 0.1

  return {
    left: `${x}%`,
    top: `${y}%`,
    width: `${size}px`,
    height: `${size}px`,
    animationDelay: `${delay}s`,
    animationDuration: `${duration}s`,
    opacity: opacity,
  }
}

// Audio base URL
const audioBaseUrl = 'https://ssi-audio-stage.s3.eu-west-1.amazonaws.com/mastered'

// Audio map for resolving text -> audio UUIDs (same as CourseExplorer)
const audioMap = ref(new Map())
const currentCourseId = ref('')

// ============================================================================
// Audio Lookup Functions (from CourseExplorer)
// ============================================================================

/**
 * Load intro audio for a set of LEGO IDs
 */
const loadIntroAudio = async (courseId, legoIds) => {
  if (!supabase?.value || legoIds.size === 0) return

  console.log('[LegoNetwork] Loading intro audio for', legoIds.size, 'LEGOs')

  // Try v12 schema first
  const { data: v12Data, error: v12Error } = await supabase.value
    .from('course_audio')
    .select('context, audio_id')
    .eq('course_code', courseId)
    .eq('role', 'presentation')
    .in('context', [...legoIds])

  if (!v12Error && v12Data && v12Data.length > 0) {
    for (const intro of v12Data) {
      if (intro.context && intro.audio_id) {
        audioMap.value.set(`intro:${intro.context}`, { intro: intro.audio_id })
      }
    }
    console.log('[LegoNetwork] Found', v12Data.length, 'intro audio entries (v12)')
    return
  }

  // Fall back to legacy
  const { data: introData, error: introError } = await supabase.value
    .from('lego_introductions')
    .select('lego_id, audio_uuid, course_code')
    .eq('course_code', courseId)
    .in('lego_id', [...legoIds])

  if (!introError) {
    for (const intro of (introData || [])) {
      audioMap.value.set(`intro:${intro.lego_id}`, { intro: intro.audio_uuid })
    }
    console.log('[LegoNetwork] Found', introData?.length || 0, 'intro audio entries (legacy)')
  }
}

/**
 * Lazy lookup audio UUID from database
 */
const lookupAudioLazy = async (text, role, isKnown = false) => {
  if (!supabase?.value || !currentCourseId.value) return null

  const cached = audioMap.value.get(text)
  if (cached?.[role]) return cached[role]

  try {
    const { data: textsData } = await supabase.value
      .from('texts')
      .select('id')
      .eq('content', text)
      .limit(1)

    if (!textsData?.length) return null

    const textId = textsData[0].id
    const { data: audioData } = await supabase.value
      .from('audio_files')
      .select('id')
      .eq('text_id', textId)

    if (!audioData?.length) return null

    const audioIds = audioData.map(a => a.id)
    const targetRole = isKnown ? 'known' : role

    const { data: courseAudio } = await supabase.value
      .from('course_audio')
      .select('audio_id, role')
      .eq('course_code', currentCourseId.value)
      .in('audio_id', audioIds)

    for (const ca of (courseAudio || [])) {
      const matchRole = isKnown ? 'known' : role
      if (ca.role === matchRole) {
        if (!audioMap.value.has(text)) audioMap.value.set(text, {})
        audioMap.value.get(text)[role] = ca.audio_id
        return ca.audio_id
      }
    }
    return null
  } catch (err) {
    console.warn('[LegoNetwork] Lazy audio lookup failed:', err)
    return null
  }
}

/**
 * Get audio URL for text+role (async, with lazy lookup)
 */
const getAudioUrlAsync = async (text, role, item = null) => {
  // Handle intro audio
  if (role === 'intro' && item?.legoId) {
    const introEntry = audioMap.value.get(`intro:${item.legoId}`)
    if (introEntry?.intro) {
      return `${audioBaseUrl}/${introEntry.intro.toUpperCase()}.mp3`
    }
    return null
  }

  // PRIORITY 1: Use audioRefs directly from item if available
  if (item?.audioRefs) {
    const refs = item.audioRefs
    let audioRef = null

    switch (role) {
      case 'known':
        audioRef = refs.known
        break
      case 'target1':
        audioRef = refs.target?.voice1 || refs.target1
        break
      case 'target2':
        audioRef = refs.target?.voice2 || refs.target2
        break
    }

    if (audioRef?.url) {
      console.log('[LegoNetwork] Using item audioRef for', role, ':', audioRef.url)
      return audioRef.url
    }
  }

  // PRIORITY 2: Check audioMap cache
  const audioEntry = audioMap.value.get(text)
  let uuid = audioEntry?.[role]

  // PRIORITY 3: Lazy lookup if not cached
  if (!uuid) {
    const isKnown = role === 'known'
    uuid = await lookupAudioLazy(text, role, isKnown)
  }

  if (!uuid) {
    console.warn('[LegoNetwork] No audio found for', role, ':', text)
    return null
  }
  return `${audioBaseUrl}/${uuid.toUpperCase()}.mp3`
}

// ============================================================================
// DEPRECATED: Demo Mode Controls
// These functions are deprecated and will be removed in a future version.
// Use Watch It Grow (startWatchItGrow) for replay functionality instead.
// ============================================================================

/** @deprecated Use startWatchItGrow instead */
const startDemo = () => {
  if (isDemoRunning.value) return

  isDemoRunning.value = true
  currentRound.value = 0
  reachedMilestones.value = []

  // Reset network to empty
  nodes.value = []
  links.value = []
  totalPractices.value = 0

  // Reinitialize visualization with empty data
  initVisualization()

  // Start the simulation
  runDemoStep()
}

const stopDemo = () => {
  isDemoRunning.value = false
  if (demoInterval) {
    clearTimeout(demoInterval)
    demoInterval = null
  }
}

const pauseDemo = () => {
  if (demoInterval) {
    clearTimeout(demoInterval)
    demoInterval = null
  }
}

const resumeDemo = () => {
  if (isDemoRunning.value && !demoInterval) {
    runDemoStep()
  }
}

const setSpeed = (speed) => {
  demoSpeed.value = speed
}

const jumpToRound = (targetRound) => {
  const wasRunning = isDemoRunning.value
  stopDemo()

  // Reset and fast-forward
  nodes.value = []
  links.value = []
  currentRound.value = 0
  reachedMilestones.value = []

  // Add nodes up to target round
  for (let i = 0; i < targetRound && allAvailableLegos.value.length > 0; i++) {
    addNextLego()
    currentRound.value = i + 1

    // Check milestones
    if (milestones.includes(currentRound.value) && !reachedMilestones.value.includes(currentRound.value)) {
      reachedMilestones.value.push(currentRound.value)
    }
  }

  // Reinitialize visualization
  initVisualization()

  if (wasRunning) {
    isDemoRunning.value = true
    runDemoStep()
  }
}

const runDemoStep = () => {
  if (!isDemoRunning.value) return

  if (currentRound.value >= maxRounds.value || allAvailableLegos.value.length === 0) {
    stopDemo()
    return
  }

  // Add a new LEGO to the network
  addNextLego()
  currentRound.value++

  // Check for milestone
  if (milestones.includes(currentRound.value) && !reachedMilestones.value.includes(currentRound.value)) {
    reachedMilestones.value.push(currentRound.value)
  }

  // Update visualization
  updateVisualization()

  // Schedule next step based on speed
  const baseDelay = 500 // 500ms at 1x speed
  const delay = baseDelay / demoSpeed.value
  demoInterval = setTimeout(runDemoStep, delay)
}

const addNextLego = () => {
  if (allAvailableLegos.value.length === 0) return

  // Pick a LEGO to add (prefer sequential order for demo)
  const nextLego = allAvailableLegos.value.shift()

  // Add as a new node with initial low mastery
  // Store birthBelt - the belt level when this LEGO was introduced
  const newNode = {
    ...nextLego,
    totalPractices: 1,
    mastery: 0.1,
    isEternal: false,
    isNew: true, // Flag for animation
    birthBelt: currentBelt.value, // Remember which belt this was learned at
  }

  nodes.value.push(newNode)
  lastAddedNode.value = newNode

  // Get existing node IDs for connection lookup
  const existingNodeIds = new Set(nodes.value.slice(0, -1).map(n => n.id))

  // Use real connections from fullNetworkData if available
  if (fullNetworkData.value) {
    // Find real connections involving the new node and existing nodes
    const realConnections = fullNetworkData.value.connections.filter(conn =>
      (conn.source === newNode.id && existingNodeIds.has(conn.target)) ||
      (conn.target === newNode.id && existingNodeIds.has(conn.source))
    )

    for (const conn of realConnections) {
      // Check if link already exists
      const exists = links.value.some(l =>
        (l.source === conn.source || l.source?.id === conn.source) &&
        (l.target === conn.target || l.target?.id === conn.target)
      )
      if (!exists) {
        links.value.push({
          source: conn.source,
          target: conn.target,
          count: conn.count,
        })
      }
    }
  } else {
    // Fallback to simulated connections
    const existingNodes = nodes.value.slice(0, -1)

    // Link to previous LEGOs in same seed
    existingNodes.forEach(existing => {
      if (existing.seedId === newNode.seedId) {
        links.value.push({
          source: existing.id,
          target: newNode.id,
          count: Math.floor(Math.random() * 10) + 1,
        })
      }
    })

    // Random cross-links for variety (simulating phrase reuse)
    if (existingNodes.length > 3 && Math.random() > 0.7) {
      const randomIdx = Math.floor(Math.random() * existingNodes.length)
      const randomNode = existingNodes[randomIdx]
      if (!links.value.some(l =>
        (l.source === randomNode.id && l.target === newNode.id) ||
        (l.source.id === randomNode.id && l.target.id === newNode.id)
      )) {
        links.value.push({
          source: randomNode.id,
          target: newNode.id,
          count: Math.floor(Math.random() * 5) + 1,
        })
      }
    }
  }

  // Increase mastery of existing nodes (simulated spaced repetition)
  nodes.value.forEach(n => {
    if (n.id !== newNode.id) {
      // Random chance of practice
      if (Math.random() > 0.6) {
        n.totalPractices++
        n.mastery = Math.min(1, n.mastery + 0.05 + Math.random() * 0.05)
        // Check for eternal status
        if (n.totalPractices > 30 && n.mastery > 0.8) {
          n.isEternal = true
        }
      }
    }
  })

  totalPractices.value = nodes.value.reduce((sum, n) => sum + n.totalPractices, 0)
}

// ============================================================================
// PATH ANIMATION UTILITIES
// ============================================================================

/**
 * Clear path animation timers
 */
const clearPathAnimationTimers = () => {
  pathAnimationTimers.forEach(t => clearTimeout(t))
  pathAnimationTimers = []
}

/**
 * Strengthen edges along a path - increment count for each edge traversed
 * This makes edges thicker over time as paths are used repeatedly
 */
const strengthenPathEdges = (legoPath) => {
  if (!legoPath || legoPath.length < 2) return

  let edgesStrengthened = 0

  for (let i = 0; i < legoPath.length - 1; i++) {
    const sourceId = legoPath[i]
    const targetId = legoPath[i + 1]

    // Find the edge in the links array (either direction)
    const edge = links.value.find(l => {
      const sId = l.source.id || l.source
      const tId = l.target.id || l.target
      return (sId === sourceId && tId === targetId) ||
             (sId === targetId && tId === sourceId)
    })

    if (edge) {
      edge.count = (edge.count || 1) + 1
      edgesStrengthened++
    } else {
      // Create new edge if it doesn't exist (path used before formal connection)
      links.value.push({
        source: sourceId,
        target: targetId,
        count: 1,
        isNew: true,
      })
      edgesStrengthened++
    }
  }

  if (edgesStrengthened > 0) {
    console.log('[LegoNetwork] Strengthened', edgesStrengthened, 'edges along path')
    // Update edge visual thickness
    updateEdgeThickness()
  }
}

/**
 * Update edge thickness based on current counts
 */
const updateEdgeThickness = () => {
  if (!linksLayer) return

  linksLayer.selectAll('.link')
    .transition()
    .duration(500)
    .attr('stroke-width', d => Math.min(1 + d.count / 15, 4))
}

/**
 * Normalize text for matching (lowercase, trim, single spaces)
 */
const normalizeText = (text) => {
  return text?.toLowerCase().trim().replace(/\s+/g, ' ') || ''
}

/**
 * Decompose a phrase into LEGO IDs using greedy longest-match
 * Uses the legoMap from networkData
 */
const decomposePhrase = (phraseText) => {
  if (!networkData.value?.legoMap || !phraseText) return []

  const legoMap = networkData.value.legoMap
  const normalized = normalizeText(phraseText)
  const words = normalized.split(' ')
  const result = []
  let i = 0

  while (i < words.length) {
    let longestMatch = null
    let longestLength = 0

    // Try to find longest matching LEGO starting at position i
    for (let len = words.length - i; len > 0; len--) {
      const candidate = words.slice(i, i + len).join(' ')
      const legoId = legoMap.get(candidate)
      if (legoId) {
        longestMatch = legoId
        longestLength = len
        break
      }
    }

    if (longestMatch) {
      result.push(longestMatch)
      i += longestLength
    } else {
      i++ // Skip unmatched word
    }
  }

  return result
}

/**
 * Animate path sequence during Voice 2 phase
 * Lights up nodes in traversal order with edge animation between consecutive nodes
 */
const animatePathSequence = (legoPath, totalDuration = 2000) => {
  if (!legoPath || legoPath.length === 0 || !nodesLayer || !linksLayer) return

  clearPathAnimationTimers()
  pathAnimationActive.value = true
  pathAnimationIds.value = [...legoPath]

  // Calculate timing - distribute animation over the audio duration
  const stepDelay = totalDuration / Math.max(legoPath.length, 1)
  const animatedNodes = new Set()
  const animatedEdges = new Set()

  // First, dim all nodes and edges
  nodesLayer.selectAll('.node')
    .classed('path-inactive', true)
    .classed('path-active', false)

  nodesLayer.selectAll('.node .node-glow')
    .transition()
    .duration(200)
    .attr('opacity', 0.15)

  nodesLayer.selectAll('.node .node-core')
    .transition()
    .duration(200)
    .attr('opacity', 0.3)

  linksLayer.selectAll('.link')
    .classed('path-inactive', true)
    .classed('path-active', false)
    .transition()
    .duration(200)
    .attr('stroke-opacity', 0.1)

  // Animate each node in sequence
  legoPath.forEach((legoId, index) => {
    const timer = setTimeout(() => {
      if (!pathAnimationActive.value) return

      // Light up this node
      animatedNodes.add(legoId)

      nodesLayer.selectAll('.node')
        .filter(d => d.id === legoId)
        .classed('path-inactive', false)
        .classed('path-active', true)
        .raise() // Bring to front

      // Animate node glow
      nodesLayer.selectAll('.node')
        .filter(d => d.id === legoId)
        .select('.node-glow')
        .transition()
        .duration(150)
        .attr('opacity', 1)
        .attr('r', 24)
        .attr('filter', 'url(#glow)')
        .transition()
        .duration(300)
        .attr('r', 20)

      // Animate node core
      nodesLayer.selectAll('.node')
        .filter(d => d.id === legoId)
        .select('.node-core')
        .transition()
        .duration(150)
        .attr('opacity', 1)
        .attr('r', 14)
        .transition()
        .duration(300)
        .attr('r', 12)

      // Animate edge from previous node
      if (index > 0) {
        const prevLegoId = legoPath[index - 1]
        const edgeKey = `${prevLegoId}->${legoId}`

        if (!animatedEdges.has(edgeKey)) {
          animatedEdges.add(edgeKey)

          // Find and animate the edge
          linksLayer.selectAll('.link')
            .filter(d => {
              const sId = d.source.id || d.source
              const tId = d.target.id || d.target
              return (sId === prevLegoId && tId === legoId) ||
                     (sId === legoId && tId === prevLegoId)
            })
            .classed('path-inactive', false)
            .classed('path-active', true)
            .each(function() {
              const link = d3.select(this)
              const totalLength = this.getTotalLength ? this.getTotalLength() : 100

              // Animate stroke-dashoffset for "drawing" effect
              link
                .attr('stroke-dasharray', totalLength)
                .attr('stroke-dashoffset', totalLength)
                .transition()
                .duration(stepDelay * 0.8)
                .ease(d3.easeLinear)
                .attr('stroke-dashoffset', 0)
                .attr('stroke-opacity', 0.9)
                .attr('stroke-width', 3)
            })
        }
      }
    }, index * stepDelay)

    pathAnimationTimers.push(timer)
  })

  console.log('[LegoNetwork] Path animation started:', legoPath.length, 'nodes over', totalDuration, 'ms')
}

/**
 * Reset path animation - keeps highlighted nodes but clears animation state
 */
const resetPathAnimation = () => {
  clearPathAnimationTimers()
  pathAnimationActive.value = false

  // Remove stroke-dasharray (reset edge style)
  if (linksLayer) {
    linksLayer.selectAll('.link')
      .classed('path-inactive', false)
      .classed('path-active', false)
      .attr('stroke-dasharray', null)
      .attr('stroke-dashoffset', null)
  }

  // Reset node classes
  if (nodesLayer) {
    nodesLayer.selectAll('.node')
      .classed('path-inactive', false)
      .classed('path-active', false)
  }

  pathAnimationIds.value = []
}

// ============================================================================
// PHRASE PRACTICE MODE
// Play through phrases containing a LEGO with path animation
// ============================================================================

let phrasePracticeTimer = null

/**
 * Play a single phrase with path animation and audio
 */
const playPhrase = async (phrase) => {
  if (!phrase || !phrase.legoPath || phrase.legoPath.length === 0) return

  currentPracticingPhrase.value = phrase

  // Animate the path through the network
  const animationDuration = Math.max(2000, phrase.legoPath.length * 500)
  animatePathSequence(phrase.legoPath, animationDuration)

  console.log('[LegoNetwork] Playing phrase:', phrase.targetText, 'path:', phrase.legoPath)

  // Play phrase audio from practice_cycles
  if (supabase?.value && courseCode.value) {
    try {
      // Initialize audio controller if needed
      if (!audioController.value) {
        audioController.value = new ScriptAudioController()
      }

      // Query practice_cycles to get audio UUIDs for this phrase
      const { data: phraseData, error } = await supabase.value
        .from('practice_cycles')
        .select('target1_audio_uuid, target2_audio_uuid')
        .eq('course_code', courseCode.value)
        .eq('target_text', phrase.targetText)
        .limit(1)
        .single()

      if (error) {
        console.warn('[LegoNetwork] Phrase audio lookup failed:', error.message)
        return
      }

      if (phraseData) {
        // Play target1 audio (primary voice)
        const audioUuid = phraseData.target1_audio_uuid || phraseData.target2_audio_uuid
        if (audioUuid) {
          const audioUrl = `${AUDIO_S3_BASE_URL}/${audioUuid}.mp3`
          console.log('[LegoNetwork] Playing phrase audio:', audioUrl)
          await audioController.value.play({ url: audioUrl, role: 'target1' })
        }
      }
    } catch (err) {
      console.warn('[LegoNetwork] Phrase audio playback error:', err)
    }
  }
}

/**
 * Start practicing through all phrases for the selected LEGO
 */
const startPhrasePractice = async () => {
  if (selectedNodePhrases.value.length === 0) return

  isPracticingPhrases.value = true
  currentPhraseIndex.value = 0

  // Play first phrase
  await playNextPhraseInPractice()
}

/**
 * Play the next phrase in practice mode
 */
const playNextPhraseInPractice = async () => {
  if (!isPracticingPhrases.value) return
  if (currentPhraseIndex.value >= selectedNodePhrases.value.length) {
    // Loop back to start
    currentPhraseIndex.value = 0
  }

  const phrase = selectedNodePhrases.value[currentPhraseIndex.value]
  await playPhrase(phrase)

  // Schedule next phrase
  const delay = Math.max(3000, phrase.legoPath.length * 600) // Give time for animation
  phrasePracticeTimer = setTimeout(() => {
    currentPhraseIndex.value++
    playNextPhraseInPractice()
  }, delay)
}

/**
 * Stop phrase practice mode
 */
const stopPhrasePractice = () => {
  isPracticingPhrases.value = false
  currentPracticingPhrase.value = null

  if (phrasePracticeTimer) {
    clearTimeout(phrasePracticeTimer)
    phrasePracticeTimer = null
  }

  // Don't reset path animation here - let closePanel do it
}

/**
 * Play a specific phrase (when user clicks on it)
 */
const playSpecificPhrase = (phrase) => {
  // Stop auto-practice if running
  stopPhrasePractice()

  // Play this phrase
  playPhrase(phrase)
}

// ============================================================================
// REPLAY MODE (formerly "Watch It Grow")
// Accelerated playback showing network growth at adjustable speed (1x-16x)
// ============================================================================
const isWatchMode = ref(false) // TODO: rename to isReplayMode
const watchSpeed = ref(2) // 1x, 2x, 4x, 8x, 16x
let watchInterval = null

const startWatchItGrow = async () => {
  if (isWatchMode.value) return

  console.log('[LegoNetwork] Starting Replay mode')
  isWatchMode.value = true

  // Load course data if not already loaded
  if (playbackQueue.value.length === 0) {
    isPlaybackLoading.value = true
    try {
      const currentCourseCode = props.course?.course_code
      if (!currentCourseCode || !courseDataProvider.value) {
        console.error('[LegoNetwork] No course or provider')
        isWatchMode.value = false
        return
      }

      // Generate learning script using the correct provider API
      // Provider now contains all config - single source of truth
      console.log('[LegoNetwork] Generating script for Replay mode')
      const script = await generateLearningScript(
        courseDataProvider.value,
        9999 // Load ALL LEGOs for full visualization
      )

      // Flatten rounds into linear list
      const flatItems = []
      for (const round of script.rounds) {
        for (const item of round.items) {
          flatItems.push({
            ...item,
            roundNumber: round.roundNumber,
          })
        }
      }

      playbackQueue.value = flatItems
      console.log('[LegoNetwork] Replay mode loaded', playbackQueue.value.length, 'items')
    } catch (err) {
      console.error('[LegoNetwork] Failed to load for Replay mode:', err)
      isWatchMode.value = false
      return
    } finally {
      isPlaybackLoading.value = false
    }
  }

  // Reset the network
  nodes.value = []
  links.value = []
  introducedLegoIds.value = new Set()
  playbackIndex.value = -1

  // Start the accelerated growth
  runWatchStep()
}

const stopWatchItGrow = () => {
  console.log('[LegoNetwork] Stopping Watch It Grow mode')
  isWatchMode.value = false
  if (watchInterval) {
    clearTimeout(watchInterval)
    watchInterval = null
  }
}

const setWatchSpeed = (speed) => {
  watchSpeed.value = speed
}

const runWatchStep = () => {
  if (!isWatchMode.value) return

  playbackIndex.value++

  if (playbackIndex.value >= playbackQueue.value.length) {
    console.log('[LegoNetwork] Watch mode complete!')
    isWatchMode.value = false
    return
  }

  const item = playbackQueue.value[playbackIndex.value]
  const legoId = item.legoId

  // Add LEGO to network if new
  if (legoId && !introducedLegoIds.value.has(legoId)) {
    introducedLegoIds.value.add(legoId)

    // Calculate belt based on current LEGO count (when this LEGO is introduced)
    const legoCount = nodes.value.length
    let birthBelt = 'white'
    if (legoCount >= 800) birthBelt = 'black'
    else if (legoCount >= 560) birthBelt = 'brown'
    else if (legoCount >= 300) birthBelt = 'purple'
    else if (legoCount >= 160) birthBelt = 'blue'
    else if (legoCount >= 80) birthBelt = 'green'
    else if (legoCount >= 40) birthBelt = 'orange'
    else if (legoCount >= 16) birthBelt = 'yellow'

    // Add node with belt-based coloring
    const newNode = {
      id: legoId,
      targetText: item.targetText,
      knownText: item.knownText,
      mastery: 0.3 + Math.random() * 0.3,
      practices: 1,
      birthBelt: birthBelt,
      isEternal: false
    }
    nodes.value.push(newNode)

    // Add REAL connections from fullNetworkData (phrase co-occurrence)
    if (fullNetworkData.value) {
      const existingNodeIds = new Set(nodes.value.slice(0, -1).map(n => n.id))
      const realConnections = fullNetworkData.value.connections.filter(conn =>
        (conn.source === legoId && existingNodeIds.has(conn.target)) ||
        (conn.target === legoId && existingNodeIds.has(conn.source))
      )

      for (const conn of realConnections) {
        links.value.push({
          source: conn.source,
          target: conn.target,
          count: conn.count,
        })
      }
    } else {
      // Fallback: connect to previous if no network data
      if (nodes.value.length > 1) {
        const prevNode = nodes.value[nodes.value.length - 2]
        links.value.push({
          source: prevNode.id,
          target: legoId,
          count: 1
        })
      }
    }

    // Update visualization
    updateVisualization()
  }

  // Schedule next step based on speed
  const baseDelay = 400 // ms at 1x
  const delay = baseDelay / watchSpeed.value
  watchInterval = setTimeout(runWatchStep, delay)
}

// ============================================================================
// DEPRECATED CYCLE CODE REMOVED
// The following functions were removed as they duplicated LearningPlayer.vue:
// - playFromIndex, runPhase, advanceToNextItem (4-phase cycle)
// - estimateSyllables, calculatePauseDuration, startPauseAnimation, stopPauseAnimation
// - introduceNewLego, updateNodeHighlights, updatePhaseHighlighting
// Learning happens in LearningPlayer.vue. LegoNetwork is for replay visualization only.
// ============================================================================

// ============================================================================
// Data Loading
// ============================================================================

const loadNetworkData = async () => {
  const useMode = props.mode
  const shouldTryReal = useMode === 'auto' || useMode === 'real'

  const learnerId = auth?.learnerId?.value
  console.log('[LegoNetwork] loadNetworkData called:', {
    mode: useMode,
    courseCode: courseCode.value,
    hasCourse: !!props.course,
    courseName: props.course?.display_name,
    hasSupabase: !!supabase?.value,
    hasAuth: !!auth,
    learnerId,
    hasProgressStore: !!progressStore?.value
  })

  // Try to load real data from database (phrase co-occurrence)
  if (shouldTryReal && supabase?.value && courseCode.value) {
    try {
      isLoading.value = true
      error.value = null

      console.log('[LegoNetwork] Attempting to load real network data for:', courseCode.value)

      // Load full network data (all LEGOs and connections)
      const realData = await loadRealNetworkData(courseCode.value)

      if (realData && realData.nodes.length > 0) {
        console.log('[LegoNetwork] Full network loaded:', realData.stats)

        // Store full network for simulation
        fullNetworkData.value = realData

        // Load learner's progress to see which LEGOs they've practiced
        let practicedLegoIds = new Set()

        // Only query progress for authenticated users (not guests)
        // Guest IDs start with 'guest-' and aren't valid UUIDs for the database
        const isGuest = !learnerId || learnerId.startsWith('guest-')

        if (!isGuest && progressStore?.value) {
          try {
            const progress = await progressStore.value.getLegoProgress(learnerId, courseCode.value)
            learnerProgress.value = progress || []
            practicedLegoIds = new Set(progress.map(p => p.lego_id))
            console.log('[LegoNetwork] Learner has practiced', practicedLegoIds.size, 'LEGOs')
          } catch (err) {
            console.warn('[LegoNetwork] Failed to load learner progress:', err)
          }
        } else if (isGuest) {
          console.log('[LegoNetwork] Guest user - skipping progress query')
        }

        // Filter to only show LEGOs the learner has practiced
        const practicedNodes = realData.nodes.filter(n => practicedLegoIds.has(n.id))

        if (practicedNodes.length > 0) {
          isRealData.value = true

          // Assign belt colors based on when learner practiced each LEGO
          // Sort by first_practiced_at if available, otherwise by order in progress
          const progressMap = new Map(learnerProgress.value.map(p => [p.lego_id, p]))
          const beltProgression = ['white', 'yellow', 'orange', 'green', 'blue', 'purple', 'brown', 'black']
          const nodesPerBelt = Math.max(1, Math.ceil(practicedNodes.length / beltProgression.length))

          nodes.value = practicedNodes.map((node, idx) => {
            const progress = progressMap.get(node.id)
            return {
              id: node.id,
              seedId: node.seedId,
              legoIndex: node.legoIndex,
              knownText: node.knownText,
              targetText: node.targetText,
              totalPractices: progress?.practice_count || 0,
              usedInPhrases: node.usedInPhrases,
              mastery: progress?.mastery_score || 0,
              isEternal: progress?.is_eternal || false,
              birthBelt: beltProgression[Math.floor(idx / nodesPerBelt)] || 'black',
              x: undefined,
              y: undefined,
            }
          })

          // Filter connections to only include practiced LEGOs
          links.value = realData.connections
            .filter(conn => practicedLegoIds.has(conn.source) && practicedLegoIds.has(conn.target))
            .map(conn => ({
              source: conn.source,
              target: conn.target,
              count: conn.count,
            }))

          totalPractices.value = nodes.value.reduce((sum, n) => sum + n.totalPractices, 0)
          currentRound.value = nodes.value.length

          console.log('[LegoNetwork] Learner network ready:', nodes.value.length, 'nodes,', links.value.length, 'connections')
        } else {
          // No LEGOs practiced yet - show empty state with simulation available
          console.log('[LegoNetwork] No LEGOs practiced yet, showing empty state')
          isRealData.value = true // Still "real" mode, just empty
          nodes.value = []
          links.value = []
          totalPractices.value = 0
          currentRound.value = 0
        }

        // Prepare simulation data (all LEGOs not yet practiced)
        const beltProgression = ['white', 'yellow', 'orange', 'green', 'blue', 'purple', 'brown', 'black']
        allAvailableLegos.value = realData.nodes
          .filter(n => !practicedLegoIds.has(n.id))
          .map((node, idx) => ({
            id: node.id,
            seedId: node.seedId,
            legoIndex: node.legoIndex,
            knownText: node.knownText,
            targetText: node.targetText,
            totalPractices: 0,
            usedInPhrases: node.usedInPhrases,
            mastery: 0,
            isEternal: false,
          }))

        maxRounds.value = allAvailableLegos.value.length

        isLoading.value = false
        return
      }
    } catch (err) {
      console.warn('[LegoNetwork] Failed to load real data, falling back:', err)
    } finally {
      isLoading.value = false
    }
  }

  // Fallback to demo/simulation mode
  isRealData.value = false

  if (!supabase?.value || !courseCode.value) {
    // Pure demo data
    createDemoData()
    isLoading.value = false
    return
  }

  try {
    isLoading.value = true
    error.value = null

    // Load all LEGOs for the course (for simulation)
    const { data: legos, error: legoError } = await supabase.value
      .from('course_legos')
      .select('lego_id, seed_id, lego_index, known_text, target_text')
      .eq('course_code', courseCode.value)
      .order('seed_id')
      .order('lego_index')
      .limit(300) // Load enough for 300 rounds

    if (legoError) throw legoError

    // Store all LEGOs for simulation
    allAvailableLegos.value = (legos || []).map((lego, idx) => ({
      id: lego.lego_id,
      seedId: lego.seed_id,
      legoIndex: lego.lego_index,
      knownText: lego.known_text,
      targetText: lego.target_text,
      totalPractices: 0,
      usedInPhrases: Math.floor(Math.random() * 15) + 1,
      mastery: 0,
      isEternal: false,
      x: undefined,
      y: undefined,
    }))

    // Start with empty network (demo mode shows growth)
    nodes.value = []
    links.value = []
    totalPractices.value = 0
    maxRounds.value = Math.min(allAvailableLegos.value.length, 300)

    console.log('[LegoNetwork] Loaded', allAvailableLegos.value.length, 'LEGOs for simulation')

  } catch (err) {
    console.error('[LegoNetwork] Load error:', err)
    error.value = 'Failed to load network data'
    createDemoData()
  } finally {
    isLoading.value = false
  }
}

const createDemoData = () => {
  // Create demo LEGOs for simulation
  const demoLegos = []
  const phrases = [
    { known: 'I want', target: 'quiero' },
    { known: 'to speak', target: 'hablar' },
    { known: 'Spanish', target: 'espanol' },
    { known: 'with you', target: 'contigo' },
    { known: 'now', target: 'ahora' },
    { known: 'I can', target: 'puedo' },
    { known: 'to learn', target: 'aprender' },
    { known: 'more', target: 'mas' },
    { known: 'I need', target: 'necesito' },
    { known: 'to practice', target: 'practicar' },
    { known: 'every day', target: 'cada dia' },
    { known: 'a little', target: 'un poco' },
    { known: 'how', target: 'como' },
    { known: 'to say', target: 'decir' },
    { known: 'this', target: 'esto' },
    { known: 'I understand', target: 'entiendo' },
    { known: 'but', target: 'pero' },
    { known: 'slowly', target: 'despacio' },
    { known: 'please', target: 'por favor' },
    { known: 'thank you', target: 'gracias' },
    { known: 'yes', target: 'si' },
    { known: 'no', target: 'no' },
    { known: 'hello', target: 'hola' },
    { known: 'goodbye', target: 'adios' },
    { known: 'good morning', target: 'buenos dias' },
    { known: 'good night', target: 'buenas noches' },
    { known: 'how are you', target: 'como estas' },
    { known: 'very well', target: 'muy bien' },
    { known: 'and you', target: 'y tu' },
    { known: 'my name is', target: 'me llamo' },
    { known: 'nice to meet you', target: 'mucho gusto' },
    { known: 'where', target: 'donde' },
    { known: 'when', target: 'cuando' },
    { known: 'why', target: 'por que' },
    { known: 'who', target: 'quien' },
    { known: 'what', target: 'que' },
    { known: 'I have', target: 'tengo' },
    { known: 'you have', target: 'tienes' },
    { known: 'he has', target: 'tiene' },
    { known: 'we have', target: 'tenemos' },
    { known: 'I am', target: 'soy' },
    { known: 'you are', target: 'eres' },
    { known: 'it is', target: 'es' },
    { known: 'we are', target: 'somos' },
    { known: 'to go', target: 'ir' },
    { known: 'to come', target: 'venir' },
    { known: 'to eat', target: 'comer' },
    { known: 'to drink', target: 'beber' },
    { known: 'water', target: 'agua' },
    { known: 'food', target: 'comida' },
  ]

  // Generate 300 LEGOs by cycling through phrases with variations
  for (let i = 0; i < 300; i++) {
    const phrase = phrases[i % phrases.length]
    if (!phrase) continue
    const seedNum = Math.floor(i / 4) + 1
    const legoIdx = (i % 4) + 1

    demoLegos.push({
      id: `S${String(seedNum).padStart(4, '0')}L${String(legoIdx).padStart(2, '0')}`,
      seedId: `S${String(seedNum).padStart(4, '0')}`,
      legoIndex: legoIdx,
      knownText: phrase.known || '',
      targetText: phrase.target || '',
      totalPractices: 0,
      usedInPhrases: Math.floor(Math.random() * 10) + 1,
      mastery: 0,
      isEternal: false,
    })
  }

  allAvailableLegos.value = demoLegos
  nodes.value = []
  links.value = []
  totalPractices.value = 0
  maxRounds.value = 300
}

// ============================================================================
// D3 Visualization
// ============================================================================

const initVisualization = () => {
  if (!containerRef.value) return

  const width = containerRef.value.clientWidth
  const height = containerRef.value.clientHeight

  // Clear existing
  d3.select(svgRef.value).selectAll('*').remove()

  svg = d3.select(svgRef.value)
    .attr('width', width)
    .attr('height', height)

  // Add glow filter
  const defs = svg.append('defs')
  const filter = defs.append('filter')
    .attr('id', 'glow')
    .attr('x', '-50%')
    .attr('y', '-50%')
    .attr('width', '200%')
    .attr('height', '200%')
  filter.append('feGaussianBlur')
    .attr('stdDeviation', '3')
    .attr('result', 'blur')
  const feMerge = filter.append('feMerge')
  feMerge.append('feMergeNode').attr('in', 'blur')
  feMerge.append('feMergeNode').attr('in', 'SourceGraphic')

  // Create zoom container group
  zoomGroup = svg.append('g').attr('class', 'zoom-container')

  // Create layers inside zoom group
  linksLayer = zoomGroup.append('g').attr('class', 'links-layer')
  nodesLayer = zoomGroup.append('g').attr('class', 'nodes-layer')
  labelsLayer = zoomGroup.append('g').attr('class', 'labels-layer')

  // Setup zoom behavior
  zoomBehavior = d3.zoom()
    .scaleExtent([VIZ_CONFIG.zoom.min, VIZ_CONFIG.zoom.max])
    .on('zoom', (event) => {
      zoomGroup.attr('transform', event.transform)
      currentZoom.value = event.transform.k
      currentTransform.value = { x: event.transform.x, y: event.transform.y, k: event.transform.k }
      // Update label visibility based on zoom level (semantic zoom)
      updateLabelOpacities()
    })

  // Apply zoom to SVG
  svg.call(zoomBehavior)
    .on('dblclick.zoom', null) // Disable double-click zoom (conflicts with node selection)

  // Create force simulation with SPREAD OUT parameters (neuron/synapse aesthetic)
  // Collision radius scales with hero node size (bigger nodes when fewer)
  const f = VIZ_CONFIG.forces
  const collisionRadius = f.collisionRadius * heroNodeScale.value

  simulation = d3.forceSimulation(nodes.value)
    .force('link', d3.forceLink(links.value)
      .id(d => d.id)
      .distance(f.linkDistance)
      .strength(f.linkStrength))
    .force('charge', d3.forceManyBody()
      .strength(f.chargeStrength)
      .distanceMax(f.chargeDistanceMax))
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force('collision', d3.forceCollide().radius(collisionRadius))
    .force('x', d3.forceX(width / 2).strength(f.centeringStrength))
    .force('y', d3.forceY(height / 2).strength(f.centeringStrength))

  // Initial render
  updateVisualization()
}

// Zoom control functions
const zoomIn = () => {
  if (!svg || !zoomBehavior) return
  svg.transition().duration(VIZ_CONFIG.timing.zoomTransition).call(zoomBehavior.scaleBy, 1.4)
}

const zoomOut = () => {
  if (!svg || !zoomBehavior) return
  svg.transition().duration(VIZ_CONFIG.timing.zoomTransition).call(zoomBehavior.scaleBy, 0.7)
}

const zoomReset = () => {
  if (!svg || !zoomBehavior || !containerRef.value) return
  const width = containerRef.value.clientWidth
  const height = containerRef.value.clientHeight
  svg.transition().duration(500).call(
    zoomBehavior.transform,
    d3.zoomIdentity.translate(0, 0).scale(1)
  )
}

const updateVisualization = () => {
  if (!svg || !linksLayer || !nodesLayer || !labelsLayer) return

  const palette = currentPalette.value
  const width = containerRef.value?.clientWidth || 800
  const height = containerRef.value?.clientHeight || 600

  // Update links
  const link = linksLayer.selectAll('.link')
    .data(links.value, d => `${d.source.id || d.source}-${d.target.id || d.target}`)

  link.exit().remove()

  link.enter()
    .append('path')
    .attr('class', 'link')
    .attr('fill', 'none')
    .attr('stroke', palette.link.base)
    .attr('stroke-width', d => Math.min(1 + d.count / 15, 4))
    .attr('opacity', 0)
    .transition()
    .duration(300)
    .attr('opacity', 0.6)

  link.attr('stroke', palette.link.base)

  // Update nodes
  const node = nodesLayer.selectAll('.node')
    .data(nodes.value, d => d.id)

  node.exit()
    .transition()
    .duration(VIZ_CONFIG.timing.nodeExit)
    .attr('opacity', 0)
    .remove()

  const nodeEnter = node.enter()
    .append('g')
    .attr('class', 'node')
    .attr('data-id', d => d.id)
    .attr('opacity', 0)
    .call(d3.drag()
      .on('start', dragstarted)
      .on('drag', dragged)
      .on('end', dragended))

  // Hero scaling - make early nodes larger for visual impact
  const scale = heroNodeScale.value
  const n = VIZ_CONFIG.node
  const glowRadius = n.glowRadius * scale
  const coreRadius = n.coreRadius * scale
  const innerRadius = n.innerRadius * scale

  // Node outer glow - uses BIRTH BELT color (when this LEGO was learned)
  nodeEnter.append('circle')
    .attr('class', 'node-glow')
    .attr('r', glowRadius)
    .attr('fill', 'none')
    .attr('stroke', d => getPalette(d.birthBelt).glow)
    .attr('stroke-width', 2 * scale)
    .attr('opacity', d => d.mastery * 0.7)
    .attr('filter', d => d.mastery > 0.5 ? 'url(#glow)' : null)

  // Node core - uses BIRTH BELT color
  nodeEnter.append('circle')
    .attr('class', 'node-core')
    .attr('r', 0)
    .attr('fill', d => {
      const nodePalette = getPalette(d.birthBelt)
      if (d.mastery > 0.7) return nodePalette.node.bright
      if (d.mastery > 0.3) return nodePalette.node.mid
      return nodePalette.node.base
    })
    .attr('stroke', d => getPalette(d.birthBelt).glow)
    .attr('stroke-width', d => (d.isEternal ? n.strokeWidthEternal : n.strokeWidth) * scale)
    .attr('stroke-opacity', d => 0.3 + d.mastery * 0.5)
    .transition()
    .duration(VIZ_CONFIG.timing.nodeEnter)
    .attr('r', coreRadius)

  // Node inner dot - uses BIRTH BELT color
  nodeEnter.append('circle')
    .attr('class', 'node-inner')
    .attr('r', innerRadius)
    .attr('fill', d => getPalette(d.birthBelt).glow)
    .attr('opacity', d => 0.3 + d.mastery * 0.6)

  // Fade in new nodes
  nodeEnter.transition()
    .duration(300)
    .attr('opacity', 1)

  // Node interactions
  nodeEnter
    .on('mouseenter', handleNodeHover)
    .on('mouseleave', handleNodeLeave)
    .on('click', handleNodeClick)

  // Update existing nodes - use BIRTH BELT colors
  const allNodes = nodesLayer.selectAll('.node')

  allNodes.select('.node-glow')
    .attr('stroke', d => getPalette(d.birthBelt).glow)
    .attr('opacity', d => d.mastery * 0.7)
    .attr('filter', d => d.mastery > 0.5 ? 'url(#glow)' : null)

  allNodes.select('.node-core')
    .attr('fill', d => {
      const nodePalette = getPalette(d.birthBelt)
      if (d.mastery > 0.7) return nodePalette.node.bright
      if (d.mastery > 0.3) return nodePalette.node.mid
      return nodePalette.node.base
    })
    .attr('stroke', d => getPalette(d.birthBelt).glow)
    .attr('stroke-width', d => d.isEternal ? 2.5 : 1.5)

  allNodes.select('.node-inner')
    .attr('fill', d => getPalette(d.birthBelt).glow)
    .attr('opacity', d => 0.3 + d.mastery * 0.6)

  // Eternal indicators - use birth belt accent color
  allNodes.each(function(d) {
    const g = d3.select(this)
    const hasEternal = g.select('.node-eternal').size() > 0

    if (d.isEternal && !hasEternal) {
      g.append('circle')
        .attr('class', 'node-eternal')
        .attr('r', 0)
        .attr('cy', -16)
        .attr('fill', getPalette(d.birthBelt).accent)
        .attr('opacity', 0.8)
        .transition()
        .duration(200)
        .attr('r', 2)
    }
  })

  // Update labels (semantic zoom - text above nodes)
  const label = labelsLayer.selectAll('.node-label')
    .data(nodes.value, d => d.id)

  label.exit()
    .transition()
    .duration(200)
    .style('opacity', 0)
    .remove()

  const labelEnter = label.enter()
    .append('g')
    .attr('class', 'node-label')
    .attr('data-id', d => d.id)
    .style('opacity', 0)
    .style('pointer-events', 'none')

  // Label background for readability
  labelEnter.append('rect')
    .attr('class', 'label-bg')
    .attr('rx', 3)
    .attr('ry', 3)
    .attr('fill', 'rgba(10, 10, 12, 0.85)')

  // Label text - targetText positioned above node
  labelEnter.append('text')
    .attr('class', 'label-text')
    .attr('y', -22)
    .attr('text-anchor', 'middle')
    .attr('dominant-baseline', 'auto')
    .attr('fill', d => getPalette(d.birthBelt).glow)
    .attr('font-family', "'DM Sans', sans-serif")
    .attr('font-size', '11px')
    .attr('font-weight', '500')
    .text(d => truncateText(d.targetText))

  // Size the background rect to fit text
  labelEnter.each(function(d) {
    const g = d3.select(this)
    const textEl = g.select('.label-text').node()
    if (textEl) {
      const bbox = textEl.getBBox()
      g.select('.label-bg')
        .attr('x', bbox.x - 4)
        .attr('y', bbox.y - 2)
        .attr('width', bbox.width + 8)
        .attr('height', bbox.height + 4)
    }
  })

  // Update existing label colors based on birth belt
  labelsLayer.selectAll('.node-label .label-text')
    .attr('fill', d => getPalette(d.birthBelt).glow)

  // Update label opacities based on current zoom
  updateLabelOpacities()

  // Update simulation
  simulation.nodes(nodes.value)
  simulation.force('link').links(links.value)
  // Update collision radius for hero scaling (adapts as network grows)
  simulation.force('collision').radius(VIZ_CONFIG.forces.collisionRadius * heroNodeScale.value)
  simulation.alpha(0.3).restart()

  // Tick function - allow nodes to spread beyond viewport (can zoom/pan to see)
  simulation.on('tick', () => {
    // Soft boundary - gentle pull back if too far from center
    const softMargin = 200
    nodes.value.forEach(d => {
      // Allow spreading but with soft bounds
      if (d.x < -softMargin) d.vx += 0.5
      if (d.x > width + softMargin) d.vx -= 0.5
      if (d.y < -softMargin) d.vy += 0.5
      if (d.y > height + softMargin) d.vy -= 0.5
    })

    linksLayer.selectAll('.link').attr('d', linkArc)
    nodesLayer.selectAll('.node').attr('transform', d => `translate(${d.x},${d.y})`)
    labelsLayer.selectAll('.node-label').attr('transform', d => `translate(${d.x},${d.y})`)
  })
}

// Calculate label opacity based on zoom level and node state
// Semantic zoom behavior (Google Maps style):
// - k < 0.5: No labels (very zoomed out)
// - 0.5 <= k < 1.0: Faint labels on hover
// - k >= 1.0: Always visible labels (at default zoom and closer)
// EXCEPTION: Active playback nodes ALWAYS show labels
const getLabelOpacity = (node, k, isHovered, isSelected, isActivePlayback) => {
  // Active playback nodes always show label (highlight mode)
  if (isActivePlayback) return 1

  // Selected node always shows label
  if (isSelected) return 1

  // Very zoomed out (k < 0.5): No labels
  if (k < 0.5) return 0

  // Medium zoom (0.5 <= k < 1.0): Faint labels on hover only
  if (k < 1.0) {
    return isHovered ? 0.7 : 0
  }

  // At default zoom and beyond (k >= 1.0): Always visible
  // Opacity increases with zoom level, maxing at 1.0
  const opacity = Math.min(0.5 + (k - 1.0) * 0.5, 1.0)
  return opacity
}

// Update all label opacities based on current zoom
const updateLabelOpacities = () => {
  if (!labelsLayer) return

  const k = currentZoom.value
  const selectedId = selectedNode.value?.id
  const hoveredId = hoveredNode.value?.id

  labelsLayer.selectAll('.node-label')
    .style('opacity', d => getLabelOpacity(d, k, d.id === hoveredId, d.id === selectedId, false))
}

// Truncate text to prevent overlap (max 15 chars)
const truncateText = (text, maxLength = 15) => {
  if (!text) return ''
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength - 1) + '...'
}

// Curved link path generator
const linkArc = (d) => {
  const sx = d.source.x || 0
  const sy = d.source.y || 0
  const tx = d.target.x || 0
  const ty = d.target.y || 0
  const dx = tx - sx
  const dy = ty - sy
  const dr = Math.sqrt(dx * dx + dy * dy) * 1.2
  return `M${sx},${sy}A${dr},${dr} 0 0,1 ${tx},${ty}`
}

// Drag functions
const dragstarted = (event, d) => {
  if (!event.active) simulation.alphaTarget(0.3).restart()
  d.fx = d.x
  d.fy = d.y
}

const dragged = (event, d) => {
  d.fx = event.x
  d.fy = event.y
}

const dragended = (event, d) => {
  if (!event.active) simulation.alphaTarget(0)
  d.fx = null
  d.fy = null
}

// ============================================================================
// Interactions
// ============================================================================

const handleNodeHover = (event, d) => {
  hoveredNode.value = d

  // Highlight connected links
  linksLayer.selectAll('.link')
    .attr('stroke', l => {
      const sId = l.source.id || l.source
      const tId = l.target.id || l.target
      if (sId === d.id || tId === d.id) {
        return currentPalette.value.link.active
      }
      return currentPalette.value.link.base
    })
    .attr('stroke-width', l => {
      const sId = l.source.id || l.source
      const tId = l.target.id || l.target
      if (sId === d.id || tId === d.id) {
        return Math.min(2 + l.count / 10, 5)
      }
      return Math.min(1 + l.count / 15, 4)
    })

  // Update label visibility (semantic zoom - show on hover at medium zoom)
  updateLabelOpacities()
}

const handleNodeLeave = () => {
  hoveredNode.value = null

  // Reset link styles
  linksLayer.selectAll('.link')
    .attr('stroke', currentPalette.value.link.base)
    .attr('stroke-width', d => Math.min(1 + d.count / 15, 4))

  // Update label visibility (semantic zoom)
  updateLabelOpacities()
}

const handleNodeClick = (event, d) => {
  event.stopPropagation()
  selectedNode.value = d
  isPanelOpen.value = true

  // Load phrases for this LEGO
  selectedNodePhrases.value = getPhrasesForLego(d.id, 20)
  currentPhraseIndex.value = 0
  isPracticingPhrases.value = false
  currentPracticingPhrase.value = null

  // Highlight selected node
  nodesLayer.selectAll('.node')
    .classed('selected', n => n.id === d.id)

  nodesLayer.selectAll('.node.selected .node-glow')
    .attr('opacity', 0.9)
    .attr('stroke', '#fbbf24')
    .attr('filter', 'url(#glow)')

  nodesLayer.selectAll('.node.selected .node-core')
    .attr('stroke', '#fbbf24')
    .attr('stroke-width', 3)

  // Update label visibility (selected node always shows label)
  updateLabelOpacities()

  // Highlight selected node's label
  labelsLayer.selectAll('.node-label')
    .classed('selected', n => n.id === d.id)

  labelsLayer.selectAll('.node-label.selected .label-text')
    .attr('fill', '#fbbf24')

  // Play audio
  playNodeAudio(d)
}

const closePanel = () => {
  isPanelOpen.value = false
  selectedNode.value = null

  // Stop phrase practice
  stopPhrasePractice()
  selectedNodePhrases.value = []

  // Reset path animation
  resetPathAnimation()

  // Reset node styles - restore birth belt colors
  nodesLayer.selectAll('.node')
    .classed('selected', false)

  nodesLayer.selectAll('.node-glow')
    .attr('stroke', d => getPalette(d.birthBelt).glow)
    .attr('opacity', d => d.mastery * 0.7)
    .attr('filter', d => d.mastery > 0.5 ? 'url(#glow)' : null)

  nodesLayer.selectAll('.node-core')
    .attr('stroke', d => getPalette(d.birthBelt).glow)
    .attr('stroke-width', d => d.isEternal ? 2.5 : 1.5)

  // Reset label styles and visibility
  labelsLayer.selectAll('.node-label')
    .classed('selected', false)

  labelsLayer.selectAll('.node-label .label-text')
    .attr('fill', d => getPalette(d.birthBelt).glow)

  // Update label visibility (semantic zoom)
  updateLabelOpacities()
}

// ============================================================================
// Audio
// ============================================================================

const playNodeAudio = async (node) => {
  if (!node) return

  isPlayingAudio.value = true

  try {
    if (!audioController.value) {
      audioController.value = new ScriptAudioController()
    }

    console.log('[LegoNetwork] Playing audio for:', node.id, node.targetText)

    // Fetch audio UUIDs from lego_cycles view
    if (supabase?.value && courseCode.value) {
      const { data: legoData, error } = await supabase.value
        .from('lego_cycles')
        .select('known_audio_uuid, target1_audio_uuid, target2_audio_uuid')
        .eq('course_code', courseCode.value)
        .eq('lego_id', node.id)
        .single()

      if (error) {
        console.warn('[LegoNetwork] Failed to fetch audio:', error.message)
      } else if (legoData) {
        console.log('[LegoNetwork] Audio UUIDs:', legoData)

        // Play sequence: known -> pause -> target1 -> target2
        const playSequence = []

        if (legoData.known_audio_uuid) {
          playSequence.push({ url: `${AUDIO_S3_BASE_URL}/${legoData.known_audio_uuid}.mp3`, role: 'known' })
        }
        if (legoData.target1_audio_uuid) {
          playSequence.push({ url: `${AUDIO_S3_BASE_URL}/${legoData.target1_audio_uuid}.mp3`, role: 'target1' })
        }
        if (legoData.target2_audio_uuid) {
          playSequence.push({ url: `${AUDIO_S3_BASE_URL}/${legoData.target2_audio_uuid}.mp3`, role: 'target2' })
        }

        for (const audio of playSequence) {
          console.log('[LegoNetwork] Playing', audio.role)
          await audioController.value.play(audio)
          // Small gap between audio clips
          await new Promise(resolve => setTimeout(resolve, 300))
        }
      }
    } else {
      console.warn('[LegoNetwork] No supabase or courseCode available')
      await new Promise(resolve => setTimeout(resolve, 1500))
    }

  } catch (err) {
    console.warn('[LegoNetwork] Audio playback failed:', err)
  } finally {
    isPlayingAudio.value = false
  }
}

// ============================================================================
// Computed Stats for Selected Node
// ============================================================================

const getTopFollowsFrom = computed(() => {
  if (!selectedNode.value) return []

  const incoming = links.value
    .filter(l => {
      const tId = l.target.id || l.target
      return tId === selectedNode.value.id
    })
    .map(l => {
      const sId = l.source.id || l.source
      const sourceNode = nodes.value.find(n => n.id === sId)
      return {
        node: sourceNode,
        count: l.count,
      }
    })
    .filter(x => x.node)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)

  return incoming
})

const getTopLeadsTo = computed(() => {
  if (!selectedNode.value) return []

  const outgoing = links.value
    .filter(l => {
      const sId = l.source.id || l.source
      return sId === selectedNode.value.id
    })
    .map(l => {
      const tId = l.target.id || l.target
      const targetNode = nodes.value.find(n => n.id === tId)
      return {
        node: targetNode,
        count: l.count,
      }
    })
    .filter(x => x.node)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)

  return outgoing
})

// ============================================================================
// Lifecycle
// ============================================================================

onMounted(async () => {
  console.log('[LegoNetwork] Mounted')
  await loadNetworkData()
  await nextTick()
  initVisualization()

  // Handle resize
  window.addEventListener('resize', handleResize)
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
  stopDemo()
  if (simulation) simulation.stop()
  if (audioController.value) {
    audioController.value.pause()
    audioController.value = null
  }
})

const handleResize = () => {
  if (!containerRef.value || !simulation) return

  const width = containerRef.value.clientWidth
  const height = containerRef.value.clientHeight

  svg.attr('width', width).attr('height', height)
  simulation.force('center', d3.forceCenter(width / 2, height / 2))
  simulation.force('x', d3.forceX(width / 2).strength(0.03))
  simulation.force('y', d3.forceY(height / 2).strength(0.03))
  simulation.alpha(0.3).restart()
}

// Watch for palette changes
watch(currentBelt, () => {
  if (simulation) {
    updateVisualization()
  }
})

// Watch for course changes - reload data when course changes
watch(courseCode, async (newCode, oldCode) => {
  if (newCode && newCode !== oldCode) {
    console.log('[LegoNetwork] Course changed:', oldCode, '→', newCode)
    await loadNetworkData()
    await nextTick()
    initVisualization()
  }
})

// Expose methods for parent component
defineExpose({
  startReplay: startWatchItGrow,
  stopReplay: stopWatchItGrow,
  isReplaying: isWatchMode,
})
</script>

<template>
  <div class="lego-network network-container" :data-belt="beltLevel" :style="{ background: currentPalette.background }">
    <!-- Background layer -->
    <div class="bg-layer"></div>

    <!-- Minimal back button - top left corner -->
    <button class="minimal-back-btn" @click="$emit('close')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M19 12H5M12 19l-7-7 7-7"/>
      </svg>
    </button>

    <!-- Minimal stats badge - top right (only during exploration, not playback) -->
    <div v-if="!isWatchMode && nodes.length > 0" class="minimal-stats">
      <span class="stat-pill">{{ nodes.length }} LEGOs</span>
    </div>

    <!-- Loading -->
    <div v-if="isLoading" class="loading">
      <div class="loading-spinner"></div>
      <p>Loading network...</p>
    </div>

    <!-- Network Viewport - FULL SCREEN -->
    <div v-else class="network-viewport" ref="containerRef" @click="closePanel">
      <svg class="network-svg" ref="svgRef"></svg>

      <!-- Atmospheric Background - Moonlit landscape that fades as network grows -->
      <div class="atmosphere-layer" :class="{ 'faded': nodes.length > VIZ_CONFIG.atmosphere.fadeThreshold }">
        <!-- Mountain silhouette -->
        <svg class="landscape-silhouette" viewBox="0 0 1200 200" preserveAspectRatio="xMidYMax slice">
          <path d="M0,200 L0,140 Q100,100 200,120 T400,90 T600,110 T800,85 T1000,100 T1200,95 L1200,200 Z" fill="rgba(15,15,25,0.8)"/>
          <path d="M0,200 L0,160 Q150,140 300,150 T600,130 T900,145 T1200,135 L1200,200 Z" fill="rgba(10,10,18,0.9)"/>
        </svg>
        <!-- Orbital hint rings -->
        <div class="orbital-rings">
          <div class="orbital-ring ring-1"></div>
          <div class="orbital-ring ring-2"></div>
          <div class="orbital-ring ring-3"></div>
        </div>
        <!-- Ambient particles -->
        <div class="ambient-particles">
          <span class="particle" v-for="i in VIZ_CONFIG.atmosphere.particleCount" :key="i" :style="getParticleStyle(i)"></span>
        </div>
      </div>

      <!-- Empty state message - enhanced -->
      <Transition name="fade">
        <div v-if="nodes.length === 0 && !isWatchMode" class="empty-state">
          <div class="empty-glow"></div>
          <div class="empty-content">
            <div class="empty-title">Your Language Network</div>
            <p class="empty-subtitle" v-if="isRealData">Each LEGO you learn becomes a star in your constellation</p>
            <p class="empty-subtitle" v-else>Tap <strong>Start Learning</strong> to begin your journey</p>
            <div class="empty-hint">
              <span class="hint-dot"></span>
              <span>Your first words will appear here</span>
            </div>
          </div>
        </div>
      </Transition>

      <!-- Early state encouragement (1-N nodes based on config) -->
      <Transition name="fade">
        <div v-if="nodes.length > 0 && nodes.length <= VIZ_CONFIG.atmosphere.earlyStateMax && !isWatchMode" class="early-state-badge">
          <span class="badge-glow"></span>
          <span class="badge-text">{{ nodes.length }} {{ nodes.length === 1 ? 'LEGO' : 'LEGOs' }} learned</span>
        </div>
      </Transition>

      <!-- Minimal Zoom Controls -->
      <div class="zoom-controls">
        <button class="zoom-btn" @click.stop="zoomIn" title="Zoom in">+</button>
        <button class="zoom-btn" @click.stop="zoomOut" title="Zoom out">−</button>
        <button class="zoom-btn reset" @click.stop="zoomReset" title="Reset">⟲</button>
      </div>

      <!-- Tooltip -->
      <div
        class="node-tooltip"
        :class="{ visible: hoveredNode && !isPanelOpen }"
        :style="tooltipPosition"
      >
        <span class="tooltip-target">{{ hoveredNode?.targetText }}</span>
        <span class="tooltip-known">{{ hoveredNode?.knownText }}</span>
      </div>
    </div>

    <!-- ====================================================================
         REPLAY PANEL - Watch network grow at adjustable speed
         ==================================================================== -->
    <Transition name="pill-slide">
      <div v-if="isWatchMode" class="watch-panel replay-panel">
        <div class="watch-header">
          <span class="watch-title">Replay</span>
          <span class="watch-count">{{ nodes.length }} LEGOs</span>
        </div>

        <!-- Speed controls -->
        <div class="speed-controls">
          <button
            v-for="speed in [1, 2, 4, 8, 16]"
            :key="speed"
            class="speed-btn"
            :class="{ active: watchSpeed === speed }"
            @click="setWatchSpeed(speed)"
          >
            {{ speed }}x
          </button>
        </div>

        <!-- Progress -->
        <div class="watch-progress">
          <div class="watch-progress-fill" :style="{ width: `${(playbackIndex / Math.max(playbackQueue.length, 1)) * 100}%` }"></div>
        </div>

        <!-- Stop -->
        <button class="watch-stop" @click="stopWatchItGrow">Stop</button>
      </div>
    </Transition>

    <!-- Action Buttons (when not replaying) -->
    <div v-if="!isWatchMode && !isPlaybackLoading" class="action-buttons">
      <!-- Replay - watch network grow -->
      <button class="action-btn replay-btn" @click="startWatchItGrow">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
          <circle cx="12" cy="12" r="10"/>
          <polygon points="10 8 16 12 10 16 10 8" fill="currentColor"/>
        </svg>
        Replay
      </button>
    </div>

    <!-- Detail Panel -->
    <div class="detail-panel" :class="{ open: isPanelOpen }">
      <button class="panel-close" @click="closePanel">×</button>

      <div v-if="selectedNode" class="panel-content">
        <!-- Header with audio -->
        <div class="panel-header">
          <div class="panel-phrase">
            <span class="phrase-target">{{ selectedNode.targetText }}</span>
            <button class="play-btn" @click="playNodeAudio(selectedNode)" :disabled="isPlayingAudio">
              <svg v-if="!isPlayingAudio" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3"/>
              </svg>
              <svg v-else viewBox="0 0 24 24" fill="currentColor" class="playing">
                <rect x="6" y="4" width="4" height="16" rx="1"/>
                <rect x="14" y="4" width="4" height="16" rx="1"/>
              </svg>
            </button>
          </div>
          <span class="phrase-known">{{ selectedNode.knownText }}</span>
        </div>

        <!-- Meta -->
        <div class="panel-meta">
          <span class="meta-id">{{ selectedNode.id }}</span>
          <span class="meta-seed">{{ selectedNode.seedId }}</span>
          <span v-if="selectedNode.isEternal" class="meta-mastered">Mastered</span>
        </div>

        <!-- Stats -->
        <div class="panel-stats">
          <div class="stat-row">
            <span class="stat-label">Practiced</span>
            <span class="stat-value">{{ selectedNode.totalPractices }} times</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Used in</span>
            <span class="stat-value">{{ selectedNode.usedInPhrases }} phrases</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Mastery</span>
            <div class="mastery-bar">
              <div class="mastery-fill" :style="{ width: `${selectedNode.mastery * 100}%` }"></div>
            </div>
          </div>
        </div>

        <!-- Follows From -->
        <div v-if="getTopFollowsFrom.length > 0" class="panel-connections">
          <span class="connections-label">Most often follows</span>
          <div class="connections-list">
            <div
              v-for="item in getTopFollowsFrom"
              :key="item.node.id"
              class="connection-item"
            >
              <span class="connection-text">{{ item.node.targetText }}</span>
              <div class="connection-bar">
                <div class="bar-fill" :style="{ width: `${Math.min(item.count * 3, 100)}%` }"></div>
              </div>
              <span class="connection-count">{{ item.count }}×</span>
            </div>
          </div>
        </div>

        <!-- Leads To -->
        <div v-if="getTopLeadsTo.length > 0" class="panel-connections">
          <span class="connections-label">Most often leads to</span>
          <div class="connections-list">
            <div
              v-for="item in getTopLeadsTo"
              :key="item.node.id"
              class="connection-item"
            >
              <span class="connection-text">{{ item.node.targetText }}</span>
              <div class="connection-bar">
                <div class="bar-fill" :style="{ width: `${Math.min(item.count * 3, 100)}%` }"></div>
              </div>
              <span class="connection-count">{{ item.count }}×</span>
            </div>
          </div>
        </div>

        <!-- Phrases containing this LEGO -->
        <div v-if="selectedNodePhrases.length > 0" class="panel-phrases">
          <div class="phrases-header">
            <span class="phrases-label">Used in {{ selectedNodePhrases.length }} phrases</span>
            <button
              class="practice-btn"
              @click="isPracticingPhrases ? stopPhrasePractice() : startPhrasePractice()"
              :class="{ practicing: isPracticingPhrases }"
            >
              <svg v-if="!isPracticingPhrases" viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                <polygon points="5 3 19 12 5 21 5 3"/>
              </svg>
              <svg v-else viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                <rect x="6" y="4" width="4" height="16" rx="1"/>
                <rect x="14" y="4" width="4" height="16" rx="1"/>
              </svg>
              {{ isPracticingPhrases ? 'Stop' : 'Practice All' }}
            </button>
          </div>

          <!-- Currently practicing phrase indicator -->
          <div v-if="currentPracticingPhrase" class="current-phrase">
            <span class="current-label">Now playing:</span>
            <span class="current-text">{{ currentPracticingPhrase.targetText }}</span>
          </div>

          <div class="phrases-list">
            <div
              v-for="(phrase, index) in selectedNodePhrases"
              :key="phrase.id"
              class="phrase-item"
              :class="{
                active: currentPracticingPhrase?.id === phrase.id,
                current: isPracticingPhrases && currentPhraseIndex === index
              }"
              @click="playSpecificPhrase(phrase)"
            >
              <span class="phrase-text">{{ phrase.targetText }}</span>
              <span class="phrase-path-count">{{ phrase.legoPath.length }} LEGOs</span>
            </div>
          </div>
        </div>
      </div>
    </div>

  </div>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=DM+Sans:wght@400;500;600;700&display=swap');

.network-container {
  position: fixed;
  inset: 0;
  background: #0a0a0c;
  font-family: 'DM Sans', -apple-system, sans-serif;
  overflow: hidden;
  z-index: 1000;
}

.bg-layer {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse at 70% 80%, rgba(139, 92, 246, 0.02) 0%, transparent 50%),
    #0a0a0c;
  pointer-events: none;
}

/* ============================================================================
   MINIMAL CONSTELLATION-FIRST UI
   ============================================================================ */

/* Minimal back button - top left */
.minimal-back-btn {
  position: absolute;
  top: env(safe-area-inset-top, 12px);
  left: 12px;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.4);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 50%;
  color: rgba(255, 255, 255, 0.7);
  cursor: pointer;
  transition: all 0.2s;
  z-index: 30;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.minimal-back-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: white;
}

.minimal-back-btn svg {
  width: 18px;
  height: 18px;
}

/* Minimal stats badge - top right */
.minimal-stats {
  position: absolute;
  top: env(safe-area-inset-top, 12px);
  right: 12px;
  z-index: 30;
}

.stat-pill {
  display: inline-block;
  padding: 6px 12px;
  background: rgba(0, 0, 0, 0.4);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 20px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

/* Loading */
.loading {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  color: rgba(255, 255, 255, 0.5);
}

.loading-spinner {
  width: 32px;
  height: 32px;
  border: 2px solid rgba(255, 255, 255, 0.1);
  border-top-color: currentColor;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }

/* Viewport - FULL SCREEN for constellation-first */
.network-viewport {
  position: absolute;
  inset: 0;
  /* No padding - constellation fills entire screen */
}

.network-svg {
  width: 100%;
  height: 100%;
  cursor: grab;
}

.network-svg:active {
  cursor: grabbing;
}

/* Empty State */
.empty-state {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  text-align: center;
  color: rgba(255, 255, 255, 0.4);
  font-size: 1rem;
}

.empty-icon {
  font-size: 4rem;
  margin-bottom: 1rem;
  opacity: 0.3;
}

/* Zoom Controls - Minimal, bottom right */
.zoom-controls {
  position: absolute;
  bottom: 100px; /* Above nav bar */
  right: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  z-index: 20;
}

.zoom-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.4);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 50%;
  color: rgba(255, 255, 255, 0.7);
  font-size: 1.125rem;
  font-weight: 300;
  cursor: pointer;
  transition: all 0.2s;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.zoom-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: white;
}

.zoom-btn:active {
  transform: scale(0.95);
}

.zoom-btn.reset {
  font-size: 0.875rem;
}

/* Tooltip */
.node-tooltip {
  position: absolute;
  pointer-events: none;
  background: rgba(18, 18, 26, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  padding: 0.625rem 0.875rem;
  opacity: 0;
  transform: translateY(4px);
  transition: all 0.15s ease;
  z-index: 100;
}

.node-tooltip.visible {
  opacity: 1;
  transform: translateY(0);
}

.tooltip-target {
  display: block;
  font-size: 1rem;
  font-weight: 600;
  color: white;
}

.tooltip-known {
  display: block;
  font-size: 0.8125rem;
  color: rgba(255, 255, 255, 0.5);
  margin-top: 0.125rem;
}

.tooltip-practices {
  display: block;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.6875rem;
  color: rgba(255, 255, 255, 0.4);
  margin-top: 0.375rem;
}

/* Detail Panel */
.detail-panel {
  position: absolute;
  top: 0;
  right: 0;
  width: 360px;
  height: 100%;
  background: #12121a;
  border-left: 1px solid rgba(255, 255, 255, 0.1);
  transform: translateX(100%);
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  z-index: 50;
  overflow-y: auto;
}

.detail-panel.open {
  transform: translateX(0);
}

.panel-close {
  position: absolute;
  top: 1rem;
  right: 1rem;
  width: 32px;
  height: 32px;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  color: rgba(255, 255, 255, 0.4);
  font-size: 1.25rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.panel-close:hover {
  border-color: rgba(255, 255, 255, 0.3);
  color: white;
}

.panel-content {
  padding: 2rem;
}

.panel-header {
  margin-bottom: 1rem;
}

.panel-phrase {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.phrase-target {
  font-size: 1.75rem;
  font-weight: 600;
  color: white;
}

.play-btn {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(212, 168, 83, 0.15);
  border: 1px solid rgba(212, 168, 83, 0.3);
  border-radius: 50%;
  color: #d4a853;
  cursor: pointer;
  transition: all 0.2s;
}

.play-btn:hover:not(:disabled) {
  background: rgba(212, 168, 83, 0.25);
  border-color: #d4a853;
}

.play-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.play-btn svg {
  width: 14px;
  height: 14px;
}

.play-btn svg.playing {
  animation: pulse 1s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.phrase-known {
  display: block;
  font-size: 1rem;
  color: rgba(255, 255, 255, 0.5);
  margin-top: 0.25rem;
}

.panel-meta {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1.5rem;
}

.meta-id, .meta-seed, .meta-mastered {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.625rem;
  text-transform: uppercase;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
}

.meta-id {
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.5);
}

.meta-seed {
  background: rgba(59, 130, 246, 0.15);
  color: #60a5fa;
}

.meta-mastered {
  background: rgba(212, 168, 83, 0.15);
  color: #d4a853;
}

.panel-stats {
  background: rgba(0, 0, 0, 0.3);
  border-radius: 10px;
  padding: 1rem;
  margin-bottom: 1.5rem;
}

.stat-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.stat-row:last-child {
  border-bottom: none;
}

.stat-row .stat-label {
  font-size: 0.8125rem;
  color: rgba(255, 255, 255, 0.5);
  text-transform: none;
  letter-spacing: 0;
}

.stat-row .stat-value {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.875rem;
  color: white;
}

.mastery-bar {
  width: 100px;
  height: 6px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 3px;
  overflow: hidden;
}

.mastery-fill {
  height: 100%;
  background: linear-gradient(90deg, #d4a853, #fbbf24);
  border-radius: 3px;
  transition: width 0.3s ease;
}

.panel-connections {
  margin-bottom: 1.5rem;
}

.connections-label {
  display: block;
  font-size: 0.625rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: rgba(255, 255, 255, 0.4);
  margin-bottom: 0.75rem;
}

.connections-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.connection-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.connection-text {
  font-size: 0.875rem;
  color: white;
  min-width: 80px;
}

.connection-bar {
  flex: 1;
  height: 4px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
  overflow: hidden;
}

.bar-fill {
  height: 100%;
  background: rgba(212, 168, 83, 0.6);
  border-radius: 2px;
}

.connection-count {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.6875rem;
  color: rgba(255, 255, 255, 0.4);
  min-width: 32px;
  text-align: right;
}

/* Phrases Section */
.panel-phrases {
  padding-top: 1rem;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  margin-top: 0.5rem;
}

.phrases-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.75rem;
}

.phrases-label {
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.5);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.practice-btn {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.375rem 0.75rem;
  font-size: 0.75rem;
  font-weight: 500;
  color: white;
  background: rgba(139, 92, 246, 0.3);
  border: 1px solid rgba(139, 92, 246, 0.5);
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.practice-btn:hover {
  background: rgba(139, 92, 246, 0.5);
}

.practice-btn.practicing {
  background: rgba(239, 68, 68, 0.3);
  border-color: rgba(239, 68, 68, 0.5);
}

.practice-btn.practicing:hover {
  background: rgba(239, 68, 68, 0.5);
}

.current-phrase {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.625rem;
  background: rgba(139, 92, 246, 0.15);
  border: 1px solid rgba(139, 92, 246, 0.3);
  border-radius: 6px;
  margin-bottom: 0.75rem;
}

.current-label {
  font-size: 0.625rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: rgba(139, 92, 246, 0.8);
}

.current-text {
  font-size: 0.9375rem;
  color: white;
  font-weight: 500;
}

.phrases-list {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  max-height: 200px;
  overflow-y: auto;
}

.phrase-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem 0.625rem;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid transparent;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.phrase-item:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.1);
}

.phrase-item.active {
  background: rgba(139, 92, 246, 0.15);
  border-color: rgba(139, 92, 246, 0.4);
}

.phrase-item.current {
  background: rgba(212, 168, 83, 0.15);
  border-color: rgba(212, 168, 83, 0.4);
}

.phrase-text {
  font-size: 0.8125rem;
  color: rgba(255, 255, 255, 0.9);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.phrase-path-count {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.625rem;
  color: rgba(255, 255, 255, 0.4);
  white-space: nowrap;
  margin-left: 0.5rem;
}

/* ============================================================================
   MINIMAL FLOATING LEARNING PILL
   ============================================================================ */

/* Learning Pill - Minimal floating overlay during playback */
.learning-pill {
  position: absolute;
  bottom: 100px; /* Above nav bar */
  left: 50%;
  transform: translateX(-50%);
  z-index: 25;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  background: rgba(0, 0, 0, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 30px;
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
}

/* Phase dots - 4 dots showing current phase */
.phase-dots {
  display: flex;
  gap: 6px;
}

.phase-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.2);
  transition: all 0.3s ease;
}

.phase-dot.active {
  background: #8b5cf6;
  box-shadow: 0 0 10px rgba(139, 92, 246, 0.8);
  animation: dot-pulse 1s ease-in-out infinite;
}

.phase-dot:nth-child(1).active { background: #60a5fa; box-shadow: 0 0 10px rgba(96, 165, 250, 0.8); } /* prompt - blue */
.phase-dot:nth-child(2).active { background: #fbbf24; box-shadow: 0 0 10px rgba(251, 191, 36, 0.8); } /* pause - yellow */
.phase-dot:nth-child(3).active { background: #4ade80; box-shadow: 0 0 10px rgba(74, 222, 128, 0.8); } /* voice1 - green */
.phase-dot:nth-child(4).active { background: #a78bfa; box-shadow: 0 0 10px rgba(167, 139, 250, 0.8); } /* voice2 - purple */

@keyframes dot-pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.3); }
}

/* Pill content - phrase text */
.pill-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-width: 200px;
}

.pill-known {
  font-size: 0.875rem;
  color: rgba(255, 255, 255, 0.9);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pill-target {
  font-size: 0.8125rem;
  color: #a78bfa;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Stop button in pill */
.pill-stop {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(239, 68, 68, 0.2);
  border: 1px solid rgba(239, 68, 68, 0.4);
  border-radius: 50%;
  color: #f87171;
  cursor: pointer;
  transition: all 0.2s;
  flex-shrink: 0;
}

.pill-stop:hover {
  background: rgba(239, 68, 68, 0.3);
}

/* Playback controls container */
.pill-controls {
  display: flex;
  gap: 6px;
  align-items: center;
}

.pill-btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 50%;
  color: rgba(255, 255, 255, 0.7);
  cursor: pointer;
  transition: all 0.2s;
}

.pill-btn:hover {
  background: rgba(255, 255, 255, 0.2);
  color: white;
}

.pill-btn.pill-stop {
  background: rgba(239, 68, 68, 0.2);
  border-color: rgba(239, 68, 68, 0.4);
  color: #f87171;
}

/* ============================================================================
   LEARNING PANE - Breathing ring UI
   ============================================================================ */

.learning-pane {
  position: absolute;
  bottom: 100px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 25;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 24px 32px;
  background: rgba(0, 0, 0, 0.75);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 24px;
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  min-width: 280px;
}

/* Breathing container - holds ring and text */
.breathing-container {
  position: relative;
  width: 180px;
  height: 180px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.breathing-container.active .breathing-ring {
  opacity: 1;
}

.breathing-ring {
  position: absolute;
  width: 100%;
  height: 100%;
  opacity: 0.3;
  transition: opacity 0.3s ease;
}

.progress-ring {
  transition: stroke-dashoffset 0.05s linear;
}

/* Breathing glow animation */
.breathing-glow {
  opacity: 0;
  transition: opacity 0.3s ease;
  transform-origin: center center;
  transform-box: fill-box;
}

.breathing-glow.breathing {
  opacity: 1;
  animation: breathe 3s ease-in-out infinite;
}

@keyframes breathe {
  0%, 100% {
    stroke-width: 6;
    stroke-opacity: 0.15;
  }
  50% {
    stroke-width: 12;
    stroke-opacity: 0.35;
  }
}

/* Text content in the center of ring */
.pane-text {
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  max-width: 160px;
  text-align: center;
}

.pane-known {
  font-size: 1.125rem;
  color: rgba(255, 255, 255, 0.95);
  font-weight: 500;
  line-height: 1.3;
}

.pane-target {
  font-size: 1.25rem;
  color: #fbbf24;
  font-weight: 600;
  line-height: 1.3;
}

/* Phase indicator */
.phase-indicator {
  display: flex;
  justify-content: center;
}

.phase-label {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  padding: 4px 12px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.6);
  transition: all 0.3s ease;
}

.phase-label.prompt {
  background: rgba(96, 165, 250, 0.2);
  color: #60a5fa;
}

.phase-label.pause {
  background: rgba(251, 191, 36, 0.2);
  color: #fbbf24;
}

.phase-label.voice1 {
  background: rgba(74, 222, 128, 0.2);
  color: #4ade80;
}

.phase-label.voice2 {
  background: rgba(167, 139, 250, 0.2);
  color: #a78bfa;
}

/* Controls row */
.pane-controls {
  display: flex;
  gap: 12px;
  align-items: center;
}

.pane-btn {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 50%;
  color: rgba(255, 255, 255, 0.7);
  cursor: pointer;
  transition: all 0.2s;
}

.pane-btn:hover {
  background: rgba(255, 255, 255, 0.2);
  color: white;
  transform: scale(1.05);
}

.pane-btn.pane-stop {
  background: rgba(239, 68, 68, 0.2);
  border-color: rgba(239, 68, 68, 0.4);
  color: #f87171;
}

.pane-btn.pane-stop:hover {
  background: rgba(239, 68, 68, 0.3);
}

/* Pane slide transition */
.pane-slide-enter-active,
.pane-slide-leave-active {
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.pane-slide-enter-from,
.pane-slide-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(20px) scale(0.95);
}

/* ============================================================================
   REPLAY MODE (formerly "Watch It Grow")
   ============================================================================ */

.watch-panel {
  position: absolute;
  bottom: 100px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 25;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 16px 24px;
  background: rgba(0, 0, 0, 0.7);
  border: 1px solid rgba(251, 191, 36, 0.3);
  border-radius: 16px;
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  min-width: 200px;
}

.watch-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  gap: 16px;
}

.watch-title {
  font-size: 0.875rem;
  font-weight: 600;
  color: #fbbf24;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.watch-count {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.8125rem;
  color: rgba(255, 255, 255, 0.7);
}

.speed-controls {
  display: flex;
  gap: 6px;
}

.speed-btn {
  padding: 6px 12px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  color: rgba(255, 255, 255, 0.6);
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.speed-btn:hover {
  background: rgba(255, 255, 255, 0.15);
  color: white;
}

.speed-btn.active {
  background: rgba(251, 191, 36, 0.2);
  border-color: #fbbf24;
  color: #fbbf24;
}

.watch-progress {
  width: 100%;
  height: 4px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
  overflow: hidden;
}

.watch-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #fbbf24, #f59e0b);
  border-radius: 2px;
  transition: width 0.3s ease;
}

.watch-stop {
  padding: 8px 20px;
  background: rgba(239, 68, 68, 0.15);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 8px;
  color: #f87171;
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.watch-stop:hover {
  background: rgba(239, 68, 68, 0.25);
}

/* Action buttons container */
.action-buttons {
  position: absolute;
  bottom: 100px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 10;
  display: flex;
  gap: 12px;
}

.action-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 24px;
  border-radius: 30px;
  font-size: 0.9375rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s;
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}

.action-btn svg {
  flex-shrink: 0;
}

/* Watch It Grow button (golden) */
.action-btn.watch-btn {
  background: rgba(251, 191, 36, 0.15);
  border: 1px solid rgba(251, 191, 36, 0.4);
  color: #fbbf24;
}

.action-btn.watch-btn:hover {
  background: rgba(251, 191, 36, 0.25);
  border-color: #fbbf24;
  box-shadow: 0 0 20px rgba(251, 191, 36, 0.3);
}

/* Replay Journey button (purple) */
.action-btn.replay-btn {
  background: rgba(167, 139, 250, 0.15);
  border: 1px solid rgba(167, 139, 250, 0.4);
  color: #a78bfa;
}

.action-btn.replay-btn:hover {
  background: rgba(167, 139, 250, 0.25);
  border-color: #a78bfa;
  box-shadow: 0 0 20px rgba(167, 139, 250, 0.3);
}

/* Progress line - super thin at bottom */
.progress-line {
  position: absolute;
  bottom: 80px; /* Just above nav bar */
  left: 20%;
  right: 20%;
  height: 2px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 1px;
  z-index: 20;
  overflow: hidden;
}

.progress-line .progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #8b5cf6, #d946ef);
  border-radius: 1px;
  transition: width 0.3s ease;
}

/* Pill slide transition */
.pill-slide-enter-active,
.pill-slide-leave-active {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.pill-slide-enter-from,
.pill-slide-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(20px);
}

/* Reveal transition for target text */
.reveal-enter-active {
  transition: all 0.4s ease-out;
}

.reveal-leave-active {
  transition: all 0.2s ease-in;
}

.reveal-enter-from {
  opacity: 0;
  transform: translateY(4px);
}

.reveal-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

/* New LEGO Introduction Overlay */
.intro-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.8);
  backdrop-filter: blur(8px);
}

.intro-content {
  position: relative;
  text-align: center;
  padding: 3rem 4rem;
}

.intro-badge {
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  color: #fbbf24;
  margin-bottom: 1.5rem;
  animation: badge-appear 0.5s ease-out;
}

@keyframes badge-appear {
  from {
    opacity: 0;
    transform: translateY(-20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.intro-target {
  font-size: 3rem;
  font-weight: 700;
  color: white;
  margin-bottom: 0.75rem;
  text-shadow: 0 0 60px rgba(139, 92, 246, 0.8);
  animation: text-reveal 0.6s ease-out 0.2s both;
}

.intro-known {
  font-size: 1.5rem;
  color: rgba(255, 255, 255, 0.6);
  animation: text-reveal 0.6s ease-out 0.4s both;
}

@keyframes text-reveal {
  from {
    opacity: 0;
    transform: scale(0.8) translateY(20px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

.intro-burst {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 300px;
  height: 300px;
  margin: -150px 0 0 -150px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(139, 92, 246, 0.3) 0%, transparent 70%);
  animation: burst-expand 1s ease-out forwards;
  pointer-events: none;
  z-index: -1;
}

@keyframes burst-expand {
  from {
    transform: scale(0);
    opacity: 1;
  }
  to {
    transform: scale(3);
    opacity: 0;
  }
}

/* Transition animations */
.slide-up-enter-active,
.slide-up-leave-active {
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.slide-up-enter-from,
.slide-up-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(20px);
}

.intro-burst-enter-active {
  transition: all 0.3s ease-out;
}

.intro-burst-leave-active {
  transition: all 0.5s ease-in;
}

.intro-burst-enter-from {
  opacity: 0;
}

.intro-burst-leave-to {
  opacity: 0;
  transform: scale(1.1);
}

/* Node highlighting during playback (D3 classes) */
.network-viewport :deep(.node.active) {
  filter: drop-shadow(0 0 15px currentColor);
  transition: filter 0.3s ease;
}

.network-viewport :deep(.node.inactive) {
  opacity: 0.3;
  transition: opacity 0.3s ease;
}

.network-viewport :deep(.node.newly-introduced) {
  animation: node-birth 1s ease-out;
}

@keyframes node-birth {
  0% {
    transform: scale(0);
    opacity: 0;
  }
  50% {
    transform: scale(1.5);
    opacity: 1;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}

/* Connection pulse during playback */
.network-viewport :deep(.link.active) {
  stroke-dasharray: 8 4;
  animation: connection-pulse 0.5s linear infinite;
}

@keyframes connection-pulse {
  from { stroke-dashoffset: 0; }
  to { stroke-dashoffset: 12; }
}

/* ============================================================================
   SEMANTIC ZOOM NODE LABELS
   Google Maps-style label visibility based on zoom level
   ============================================================================ */

/* Labels layer positioned above nodes */
.network-viewport :deep(.labels-layer) {
  pointer-events: none;
}

/* Node label container */
.network-viewport :deep(.node-label) {
  pointer-events: none;
  /* Smooth opacity transitions for semantic zoom */
  transition: opacity 0.25s ease-out;
}

/* Label background - subtle dark pill for readability */
.network-viewport :deep(.node-label .label-bg) {
  fill: rgba(10, 10, 12, 0.85);
  stroke: rgba(255, 255, 255, 0.08);
  stroke-width: 0.5;
}

/* Label text styling - clean, small font matching Moonlit Dojo theme */
.network-viewport :deep(.node-label .label-text) {
  font-family: 'DM Sans', -apple-system, sans-serif;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.01em;
  /* Smooth color transitions for hover/selection states */
  transition: fill 0.2s ease;
  /* Text rendering for clarity */
  text-rendering: optimizeLegibility;
}

/* Selected node label gets highlight color */
.network-viewport :deep(.node-label.selected .label-text) {
  fill: #fbbf24 !important;
}

.network-viewport :deep(.node-label.selected .label-bg) {
  fill: rgba(251, 191, 36, 0.15);
  stroke: rgba(251, 191, 36, 0.3);
}

/* ============================================================================
   RESPONSIVE - Mobile-first, constellation-first
   ============================================================================ */

/* Mobile: Bottom sheet detail panel */
@media (max-width: 768px) {
  .detail-panel {
    width: 100%;
    height: 50%;
    top: auto;
    bottom: 0;
    transform: translateY(100%);
    border-left: none;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 20px 20px 0 0;
  }

  .detail-panel.open {
    transform: translateY(0);
  }

  /* Learning pill adjustments for mobile */
  .learning-pill {
    bottom: 90px;
    max-width: calc(100% - 24px);
    padding: 8px 12px;
  }

  .pill-content {
    max-width: 150px;
  }

  .pill-known {
    font-size: 0.8125rem;
  }

  .pill-target {
    font-size: 0.75rem;
  }

  /* Progress line for mobile */
  .progress-line {
    left: 10%;
    right: 10%;
  }

  /* Intro overlay for mobile */
  .intro-overlay .intro-content {
    padding: 2rem;
  }

  .intro-target {
    font-size: 2rem;
  }

  .intro-known {
    font-size: 1.125rem;
  }

  /* Zoom controls for mobile */
  .zoom-controls {
    bottom: 90px;
  }
}

/* Desktop enhancements */
@media (min-width: 769px) {
  /* Larger learning pill on desktop */
  .learning-pill {
    padding: 12px 20px;
    gap: 16px;
  }

  .pill-content {
    max-width: 280px;
  }

  .pill-known {
    font-size: 1rem;
  }

  .pill-target {
    font-size: 0.9375rem;
  }

  .phase-dot {
    width: 10px;
    height: 10px;
  }

  /* More subtle stats on desktop */
  .minimal-stats {
    top: 16px;
    right: 16px;
  }

  .stat-pill {
    padding: 8px 16px;
    font-size: 0.8125rem;
  }

  /* Zoom controls with more spacing */
  .zoom-controls {
    bottom: 120px;
    right: 16px;
    gap: 6px;
  }

  .zoom-btn {
    width: 36px;
    height: 36px;
    font-size: 1.25rem;
  }
}

/* Large desktop - more generous spacing */
@media (min-width: 1200px) {
  .learning-pill {
    padding: 14px 24px;
  }

  .pill-content {
    max-width: 350px;
  }

  .zoom-controls {
    right: 24px;
    bottom: 140px;
  }
}

/* ============================================================================
   ATMOSPHERIC EMPTY/EARLY STATE
   Creates an inviting cosmic void when the network is sparse
   ============================================================================ */

/* Atmosphere layer - fades as network grows */
.atmosphere-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 1;
  transition: opacity 1.5s ease-out;
  overflow: hidden;
}

.atmosphere-layer.faded {
  opacity: 0;
}

/* Mountain silhouette at bottom - creates grounding horizon */
.landscape-silhouette {
  position: absolute;
  bottom: 60px;
  left: 0;
  right: 0;
  width: 100%;
  height: auto;
  opacity: 0.4;
  animation: landscape-fade-in 2s ease-out;
}

@keyframes landscape-fade-in {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 0.4;
    transform: translateY(0);
  }
}

/* Orbital hint rings - suggest where nodes will appear */
.orbital-rings {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.orbital-ring {
  position: absolute;
  border: 1px dashed rgba(255, 255, 255, 0.06);
  border-radius: 50%;
  animation: orbital-breathe 8s ease-in-out infinite;
}

.orbital-ring.ring-1 {
  width: 150px;
  height: 150px;
  animation-delay: 0s;
}

.orbital-ring.ring-2 {
  width: 280px;
  height: 280px;
  animation-delay: 2s;
}

.orbital-ring.ring-3 {
  width: 420px;
  height: 420px;
  animation-delay: 4s;
}

@keyframes orbital-breathe {
  0%, 100% {
    transform: scale(1);
    opacity: 0.4;
  }
  50% {
    transform: scale(1.05);
    opacity: 0.7;
  }
}

/* Ambient particles - fireflies/stars drifting gently */
.ambient-particles {
  position: absolute;
  inset: 0;
}

.particle {
  position: absolute;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.3;
  animation: particle-drift linear infinite;
}

/* Dynamic particle styling applied via JS getParticleStyle() */

@keyframes particle-drift {
  0% {
    transform: translate(0, 0) scale(1);
    opacity: 0.2;
  }
  25% {
    transform: translate(10px, -15px) scale(1.2);
    opacity: 0.5;
  }
  50% {
    transform: translate(5px, -30px) scale(1);
    opacity: 0.3;
  }
  75% {
    transform: translate(-5px, -20px) scale(1.1);
    opacity: 0.4;
  }
  100% {
    transform: translate(0, 0) scale(1);
    opacity: 0.2;
  }
}

/* Enhanced empty state with atmospheric messaging */
.empty-state {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  text-align: center;
  z-index: 5;
}

.empty-state .empty-glow {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 300px;
  height: 300px;
  transform: translate(-50%, -50%);
  background: radial-gradient(circle, rgba(255,255,255,0.03) 0%, transparent 70%);
  pointer-events: none;
  animation: empty-glow-pulse 4s ease-in-out infinite;
}

@keyframes empty-glow-pulse {
  0%, 100% { opacity: 0.5; transform: translate(-50%, -50%) scale(1); }
  50% { opacity: 1; transform: translate(-50%, -50%) scale(1.1); }
}

.empty-state .empty-content {
  position: relative;
  z-index: 1;
}

.empty-state .empty-title {
  font-size: 1.375rem;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.85);
  margin-bottom: 0.625rem;
  letter-spacing: 0.02em;
}

.empty-state .empty-subtitle {
  font-size: 0.9375rem;
  color: rgba(255, 255, 255, 0.45);
  max-width: 280px;
  line-height: 1.5;
  margin: 0 auto 1rem;
}

.empty-state .empty-subtitle strong {
  color: #fbbf24;
  font-weight: 600;
}

.empty-state .empty-hint {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 0.8125rem;
  color: rgba(255, 255, 255, 0.35);
}

.empty-state .hint-dot {
  width: 6px;
  height: 6px;
  background: rgba(255, 255, 255, 0.3);
  border-radius: 50%;
  animation: hint-pulse 2s ease-in-out infinite;
}

@keyframes hint-pulse {
  0%, 100% { opacity: 0.3; transform: scale(1); }
  50% { opacity: 0.8; transform: scale(1.2); }
}

/* Early state badge - shown when 1-5 nodes */
.early-state-badge {
  position: absolute;
  top: 70px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 10;
  padding: 6px 14px;
  background: rgba(251, 191, 36, 0.12);
  border: 1px solid rgba(251, 191, 36, 0.25);
  border-radius: 20px;
  font-size: 0.75rem;
  font-weight: 600;
  color: #fbbf24;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  display: flex;
  align-items: center;
  gap: 6px;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.early-state-badge .badge-glow {
  position: absolute;
  inset: -2px;
  border-radius: 22px;
  background: linear-gradient(135deg, rgba(251, 191, 36, 0.2), transparent);
  animation: badge-shimmer 3s ease-in-out infinite;
  pointer-events: none;
}

@keyframes badge-shimmer {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 1; }
}

.early-state-badge .badge-text {
  position: relative;
  z-index: 1;
}

@keyframes badge-glow {
  0%, 100% {
    box-shadow: 0 0 10px rgba(251, 191, 36, 0.1);
  }
  50% {
    box-shadow: 0 0 20px rgba(251, 191, 36, 0.2);
  }
}

@keyframes pulse-glow {
  0%, 100% {
    opacity: 0.5;
    transform: scale(1);
  }
  50% {
    opacity: 1;
    transform: scale(1.3);
  }
}

/* Color the particles based on belt level (inherited from container) */
.lego-network[data-belt="white"] .particle { color: #ffffff; }
.lego-network[data-belt="yellow"] .particle { color: #fbbf24; }
.lego-network[data-belt="orange"] .particle { color: #fb923c; }
.lego-network[data-belt="green"] .particle { color: #4ade80; }
.lego-network[data-belt="blue"] .particle { color: #60a5fa; }
.lego-network[data-belt="purple"] .particle { color: #a78bfa; }
.lego-network[data-belt="brown"] .particle { color: #a8836a; }
.lego-network[data-belt="black"] .particle { color: #d4a853; }

/* Responsive adjustments for atmosphere */
@media (max-width: 768px) {
  .orbital-ring.ring-1 { width: 100px; height: 100px; }
  .orbital-ring.ring-2 { width: 180px; height: 180px; }
  .orbital-ring.ring-3 { width: 280px; height: 280px; }

  .early-state-badge {
    top: 60px;
    font-size: 0.6875rem;
    padding: 5px 12px;
  }

  .empty-state .empty-icon {
    font-size: 2.5rem;
  }

  .empty-state .empty-title {
    font-size: 1.125rem;
  }

  .empty-state .empty-subtitle {
    font-size: 0.875rem;
    max-width: 240px;
  }
}
</style>
