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
import {
  CycleOrchestrator,
  AudioController,
  CyclePhase,
  DEFAULT_CONFIG,
} from '@ssi/core'
import { generateLearningScript } from '../providers/CourseDataProvider'

const emit = defineEmits(['close'])

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
const courseDataProvider = inject('courseDataProvider', null)

// Use the LEGO network composable for real data
const {
  isLoading: networkLoading,
  error: networkError,
  networkData,
  loadNetworkData: loadRealNetworkData,
  getLegoConnections
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
let zoomBehavior = null
const currentZoom = ref(1)

// UI state
const selectedNode = ref(null)
const hoveredNode = ref(null)
const isPanelOpen = ref(false)

// Audio
const audioController = ref(null)
const isPlayingAudio = ref(false)

// ============================================================================
// BRAIN VIEW PLAYBACK MODE
// Play the course with real-time visualization of learning
// ============================================================================
const isPlaybackMode = ref(false)
const isPlaybackLoading = ref(false)
const playbackQueue = ref([]) // All learning items for the session
const playbackIndex = ref(0) // Current position in queue
const currentItem = ref(null) // Current learning item being played
const currentPhase = ref('idle') // 'idle' | 'prompt' | 'pause' | 'voice_1' | 'voice_2'
const orchestrator = ref(null) // CycleOrchestrator instance
const activeLegoIds = ref([]) // LEGOs highlighted during current phrase
const introducedLegoIds = ref(new Set()) // LEGOs that have been introduced
const isIntroducingLego = ref(false) // True when showing intro animation
const introLego = ref(null) // The LEGO being introduced

// Audio S3 base URL
const AUDIO_S3_BASE_URL = 'https://ssi-audio-stage.s3.eu-west-1.amazonaws.com/mastered'

// Phase display names
const phaseLabels = {
  idle: 'Ready',
  prompt: 'Listen...',
  pause: 'Your turn!',
  voice_1: 'Voice 1',
  voice_2: 'Voice 2',
}

// Demo/Simulation state
const isDemoRunning = ref(false)
const currentRound = ref(0)
const demoSpeed = ref(1) // 1x, 2x, 4x, 8x
const maxRounds = ref(300)
let demoInterval = null
const milestones = [50, 100, 150, 200, 250, 300]
const reachedMilestones = ref([])
const lastAddedNode = ref(null)

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

// Calculate current belt based on round count
const currentBelt = computed(() => {
  const r = currentRound.value
  if (r >= 280) return 'black'
  if (r >= 150) return 'brown'
  if (r >= 80) return 'purple'
  if (r >= 40) return 'blue'
  if (r >= 20) return 'green'
  if (r >= 10) return 'orange'
  if (r >= 5) return 'yellow'
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

// Audio base URL
const audioBaseUrl = 'https://ssi-audio-stage.s3.eu-west-1.amazonaws.com/mastered'

// ============================================================================
// Demo Mode Controls
// ============================================================================

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
// BRAIN VIEW PLAYBACK CONTROLS
// ============================================================================

/**
 * Start playback mode - load session and begin playing
 */
const startPlayback = async () => {
  if (isPlaybackMode.value || !courseCode.value) return

  console.log('[LegoNetwork] Starting playback mode for:', courseCode.value)
  isPlaybackLoading.value = true
  isPlaybackMode.value = true

  try {
    // Load learning script for this course
    if (courseDataProvider?.value && supabase?.value) {
      const { rounds, allItems } = await generateLearningScript(
        courseDataProvider.value,
        supabase.value,
        courseCode.value,
        AUDIO_S3_BASE_URL,
        30, // maxLegos - start with 30 for brain view
      )

      if (allItems && allItems.length > 0) {
        playbackQueue.value = allItems
        playbackIndex.value = 0
        introducedLegoIds.value = new Set(nodes.value.map(n => n.id))

        console.log('[LegoNetwork] Loaded', allItems.length, 'items for playback')

        // Initialize audio controller
        if (!audioController.value) {
          audioController.value = new AudioController()
        }

        // Create orchestrator
        const config = {
          ...DEFAULT_CONFIG.cycle,
          pauseDurationMultiplier: 2.0,
        }
        orchestrator.value = new CycleOrchestrator(audioController.value, config)

        // Set up event handlers
        setupOrchestratorEvents()

        // Start first item
        await playNextItem()
      } else {
        console.warn('[LegoNetwork] No items loaded for playback')
        error.value = 'No learning content available'
        stopPlayback()
      }
    } else {
      console.warn('[LegoNetwork] No courseDataProvider or supabase available')
      error.value = 'Database not available'
      stopPlayback()
    }
  } catch (err) {
    console.error('[LegoNetwork] Failed to start playback:', err)
    error.value = 'Failed to load learning content'
    stopPlayback()
  } finally {
    isPlaybackLoading.value = false
  }
}

/**
 * Stop playback mode
 */
const stopPlayback = () => {
  console.log('[LegoNetwork] Stopping playback')
  isPlaybackMode.value = false
  currentPhase.value = 'idle'
  currentItem.value = null
  activeLegoIds.value = []
  isIntroducingLego.value = false
  introLego.value = null

  if (orchestrator.value) {
    orchestrator.value.stop()
    orchestrator.value = null
  }

  // Reset node highlights
  updateNodeHighlights([])
}

/**
 * Play the next item in the queue
 */
const playNextItem = async () => {
  if (!orchestrator.value || playbackIndex.value >= playbackQueue.value.length) {
    console.log('[LegoNetwork] Playback complete')
    stopPlayback()
    return
  }

  const item = playbackQueue.value[playbackIndex.value]
  currentItem.value = item
  playbackIndex.value++

  console.log('[LegoNetwork] Playing item:', item.lego?.id, item.phrase?.phrase?.target)

  // Check if this introduces a new LEGO
  const legoId = item.lego?.id
  if (legoId && !introducedLegoIds.value.has(legoId)) {
    // New LEGO! Show introduction animation
    await introduceNewLego(item)
  }

  // Determine which LEGOs are active in this phrase
  const phraseLegoIds = getLegoIdsFromPhrase(item)
  activeLegoIds.value = phraseLegoIds

  // Highlight active nodes
  updateNodeHighlights(phraseLegoIds)

  // Start the audio cycle
  try {
    await orchestrator.value.startItem(item)
  } catch (err) {
    console.error('[LegoNetwork] Error playing item:', err)
    // Continue to next item on error
    setTimeout(playNextItem, 500)
  }
}

/**
 * Introduce a new LEGO with animation
 */
const introduceNewLego = async (item) => {
  const legoId = item.lego?.id
  if (!legoId) return

  console.log('[LegoNetwork] Introducing new LEGO:', legoId)

  isIntroducingLego.value = true
  introLego.value = item.lego

  // Add the new node to the network
  const newNode = {
    id: legoId,
    seedId: item.seed?.seed_id || '',
    legoIndex: parseInt(legoId.split('L')[1]) || 1,
    knownText: item.lego?.lego?.known || '',
    targetText: item.lego?.lego?.target || '',
    totalPractices: 0,
    usedInPhrases: 1,
    mastery: 0.1,
    isEternal: false,
    birthBelt: currentBelt.value,
    isNew: true,
  }

  nodes.value.push(newNode)
  introducedLegoIds.value.add(legoId)

  // Add connections from fullNetworkData if available
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
  }

  // Update visualization
  updateVisualization()

  // Show intro for a moment
  await new Promise(resolve => setTimeout(resolve, 1500))
  isIntroducingLego.value = false
}

/**
 * Get LEGO IDs from a phrase (using decomposition)
 */
const getLegoIdsFromPhrase = (item) => {
  const legoIds = []

  // Primary LEGO
  if (item.lego?.id) {
    legoIds.push(item.lego.id)
  }

  // Phrase may contain multiple LEGOs
  if (item.phrase?.containsLegos) {
    for (const id of item.phrase.containsLegos) {
      if (!legoIds.includes(id)) {
        legoIds.push(id)
      }
    }
  }

  return legoIds
}

/**
 * Set up orchestrator event handlers
 */
const setupOrchestratorEvents = () => {
  if (!orchestrator.value) return

  orchestrator.value.addEventListener((event) => {
    switch (event.type) {
      case 'phase_changed':
        handlePhaseChange(event.data.phase)
        break

      case 'item_completed':
        handleItemCompleted()
        break

      case 'error':
        console.error('[LegoNetwork] Orchestrator error:', event.data?.error)
        // Continue to next item on error
        setTimeout(playNextItem, 500)
        break
    }
  })
}

/**
 * Handle phase changes - update visualization
 */
const handlePhaseChange = (phase) => {
  // Map CyclePhase to our phase names
  switch (phase) {
    case CyclePhase.PROMPT:
      currentPhase.value = 'prompt'
      break
    case CyclePhase.PAUSE:
      currentPhase.value = 'pause'
      break
    case CyclePhase.VOICE_1:
      currentPhase.value = 'voice_1'
      break
    case CyclePhase.VOICE_2:
      currentPhase.value = 'voice_2'
      break
    default:
      currentPhase.value = 'idle'
  }

  // Update node highlighting based on phase
  updatePhaseHighlighting()
}

/**
 * Handle item completion - move to next
 */
const handleItemCompleted = () => {
  console.log('[LegoNetwork] Item completed, moving to next')

  // Brief pause between items
  setTimeout(() => {
    if (isPlaybackMode.value) {
      playNextItem()
    }
  }, 300)
}

/**
 * Update node highlighting based on active LEGOs
 */
const updateNodeHighlights = (legoIds) => {
  if (!nodesLayer) return

  const activeSet = new Set(legoIds)

  nodesLayer.selectAll('.node')
    .classed('active', d => activeSet.has(d.id))
    .classed('inactive', d => legoIds.length > 0 && !activeSet.has(d.id))

  // Update glow intensity
  nodesLayer.selectAll('.node.active .node-glow')
    .attr('opacity', 1)
    .attr('filter', 'url(#glow)')

  nodesLayer.selectAll('.node.inactive .node-glow')
    .attr('opacity', 0.2)

  // Highlight connections between active nodes
  if (linksLayer) {
    linksLayer.selectAll('.link')
      .classed('active', d => {
        const sId = d.source.id || d.source
        const tId = d.target.id || d.target
        return activeSet.has(sId) && activeSet.has(tId)
      })
      .attr('stroke-opacity', d => {
        const sId = d.source.id || d.source
        const tId = d.target.id || d.target
        return (activeSet.has(sId) && activeSet.has(tId)) ? 1 : 0.3
      })
  }
}

/**
 * Update visual style based on current phase
 */
const updatePhaseHighlighting = () => {
  if (!nodesLayer) return

  const phase = currentPhase.value
  const isActive = phase !== 'idle'

  // Phase-specific visual effects
  nodesLayer.selectAll('.node.active .node-core')
    .transition()
    .duration(200)
    .attr('r', phase === 'pause' ? 16 : phase === 'voice_2' ? 14 : 12)

  // Pulse effect during pause (learner speaking)
  if (phase === 'pause') {
    nodesLayer.selectAll('.node.active .node-glow')
      .transition()
      .duration(400)
      .attr('r', 24)
      .attr('opacity', 0.9)
      .transition()
      .duration(400)
      .attr('r', 18)
      .attr('opacity', 0.7)
  }

  // Bright flash on voice_2 (answer revealed)
  if (phase === 'voice_2') {
    nodesLayer.selectAll('.node.active .node-glow')
      .transition()
      .duration(100)
      .attr('opacity', 1)
      .attr('stroke-width', 4)
      .transition()
      .duration(500)
      .attr('stroke-width', 2)
  }
}

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
    const seedNum = Math.floor(i / 4) + 1
    const legoIdx = (i % 4) + 1

    demoLegos.push({
      id: `S${String(seedNum).padStart(4, '0')}L${String(legoIdx).padStart(2, '0')}`,
      seedId: `S${String(seedNum).padStart(4, '0')}`,
      legoIndex: legoIdx,
      knownText: phrase.known,
      targetText: phrase.target,
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

  // Setup zoom behavior
  zoomBehavior = d3.zoom()
    .scaleExtent([0.2, 4]) // Min 20%, max 400%
    .on('zoom', (event) => {
      zoomGroup.attr('transform', event.transform)
      currentZoom.value = event.transform.k
      currentTransform.value = { x: event.transform.x, y: event.transform.y, k: event.transform.k }
    })

  // Apply zoom to SVG
  svg.call(zoomBehavior)
    .on('dblclick.zoom', null) // Disable double-click zoom (conflicts with node selection)

  // Create force simulation with SPREAD OUT parameters (neuron/synapse aesthetic)
  simulation = d3.forceSimulation(nodes.value)
    .force('link', d3.forceLink(links.value)
      .id(d => d.id)
      .distance(120) // Increased from 60 - longer dendrite-like connections
      .strength(0.3)) // Reduced strength for more organic feel
    .force('charge', d3.forceManyBody()
      .strength(-400) // Much stronger repulsion (was -150)
      .distanceMax(500)) // Increased range of repulsion
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force('collision', d3.forceCollide().radius(35)) // Increased from 20
    .force('x', d3.forceX(width / 2).strength(0.015)) // Reduced centering force
    .force('y', d3.forceY(height / 2).strength(0.015)) // Reduced centering force

  // Initial render
  updateVisualization()
}

// Zoom control functions
const zoomIn = () => {
  if (!svg || !zoomBehavior) return
  svg.transition().duration(300).call(zoomBehavior.scaleBy, 1.4)
}

const zoomOut = () => {
  if (!svg || !zoomBehavior) return
  svg.transition().duration(300).call(zoomBehavior.scaleBy, 0.7)
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
  if (!svg || !linksLayer || !nodesLayer) return

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
    .duration(200)
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

  // Node outer glow - uses BIRTH BELT color (when this LEGO was learned)
  nodeEnter.append('circle')
    .attr('class', 'node-glow')
    .attr('r', 18)
    .attr('fill', 'none')
    .attr('stroke', d => getPalette(d.birthBelt).glow)
    .attr('stroke-width', 2)
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
    .attr('stroke-width', d => d.isEternal ? 2.5 : 1.5)
    .attr('stroke-opacity', d => 0.3 + d.mastery * 0.5)
    .transition()
    .duration(300)
    .attr('r', 12)

  // Node inner dot - uses BIRTH BELT color
  nodeEnter.append('circle')
    .attr('class', 'node-inner')
    .attr('r', 4)
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

  // Update simulation
  simulation.nodes(nodes.value)
  simulation.force('link').links(links.value)
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
  })
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
}

const handleNodeLeave = () => {
  hoveredNode.value = null

  // Reset link styles
  linksLayer.selectAll('.link')
    .attr('stroke', currentPalette.value.link.base)
    .attr('stroke-width', d => Math.min(1 + d.count / 15, 4))
}

const handleNodeClick = (event, d) => {
  event.stopPropagation()
  selectedNode.value = d
  isPanelOpen.value = true

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

  // Play audio
  playNodeAudio(d)
}

const closePanel = () => {
  isPanelOpen.value = false
  selectedNode.value = null

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
}

// ============================================================================
// Audio
// ============================================================================

const playNodeAudio = async (node) => {
  if (!node) return

  isPlayingAudio.value = true

  try {
    if (!audioController.value) {
      audioController.value = new Audio()
    }

    console.log('[LegoNetwork] Playing audio for:', node.targetText)
    await new Promise(resolve => setTimeout(resolve, 1500))

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
</script>

<template>
  <div class="network-container" :style="{ background: currentPalette.background }">
    <!-- Background layer -->
    <div class="bg-layer"></div>

    <!-- Header -->
    <header class="network-header">
      <div class="header-left">
        <button class="back-btn" @click="$emit('close')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
        </button>
        <div class="header-content">
          <h1 class="network-title">Progress Map</h1>
          <p class="network-subtitle">{{ courseName }}</p>
        </div>
      </div>
      <div class="header-right">
        <div class="belt-indicator" :class="currentBelt">
          <span class="belt-dot"></span>
          <span class="belt-name">{{ currentPalette.name }}</span>
        </div>
        <div class="stats-group">
          <div class="stat">
            <span class="stat-value">{{ legoCount }}</span>
            <span class="stat-label">LEGOs</span>
          </div>
          <div class="stat">
            <span class="stat-value">{{ practiceCount }}</span>
            <span class="stat-label">Practices</span>
          </div>
          <div class="stat">
            <span class="stat-value">{{ masteredCount }}</span>
            <span class="stat-label">Mastered</span>
          </div>
        </div>
      </div>
    </header>

    <!-- Your Brain Map (learner has progress) -->
    <div v-if="isRealData && nodes.length > 0" class="data-mode-indicator">
      <span class="data-mode-badge real">Your Brain Map</span>
      <span class="data-mode-info">{{ nodes.length }} LEGOs learned · {{ links.length }} connections</span>
    </div>

    <!-- Empty state for new learners -->
    <div v-else-if="isRealData && nodes.length === 0" class="data-mode-indicator empty">
      <span class="data-mode-badge empty">Start Learning</span>
      <span class="data-mode-info">Your brain map will grow as you learn each LEGO</span>
    </div>

    <!-- BRAIN VIEW PLAYBACK CONTROLS -->
    <div class="playback-controls" :class="{ 'with-data': isRealData && nodes.length > 0 }">
      <button
        v-if="!isPlaybackMode"
        class="playback-btn magic"
        :disabled="isPlaybackLoading || !courseCode"
        @click="startPlayback"
      >
        <span class="playback-icon">🧠</span>
        <span>{{ isPlaybackLoading ? 'Loading...' : 'Learn in Brain View' }}</span>
        <span class="playback-sparkle">✨</span>
      </button>
      <button
        v-else
        class="playback-btn stop"
        @click="stopPlayback"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
          <rect x="6" y="6" width="12" height="12"/>
        </svg>
        <span>Stop Learning</span>
      </button>
    </div>

    <!-- NOW PLAYING PANEL (during playback) -->
    <Transition name="slide-up">
      <div v-if="isPlaybackMode && currentItem" class="now-playing-panel">
        <div class="now-playing-header">
          <span class="now-playing-label">Now Learning</span>
          <span class="phase-badge" :class="currentPhase">{{ phaseLabels[currentPhase] }}</span>
        </div>

        <div class="now-playing-content">
          <!-- Target phrase -->
          <div class="phrase-display">
            <span class="phrase-target" :class="{ revealed: currentPhase === 'voice_2' }">
              {{ currentItem.phrase?.phrase?.target || currentItem.lego?.lego?.target }}
            </span>
            <span class="phrase-known">
              {{ currentItem.phrase?.phrase?.known || currentItem.lego?.lego?.known }}
            </span>
          </div>

          <!-- Active LEGOs indicator -->
          <div class="active-legos">
            <span
              v-for="legoId in activeLegoIds"
              :key="legoId"
              class="lego-chip"
              :class="{ primary: legoId === currentItem.lego?.id }"
            >
              {{ legoId }}
            </span>
          </div>

          <!-- Progress -->
          <div class="playback-progress">
            <span class="progress-text">{{ playbackIndex }} / {{ playbackQueue.length }}</span>
            <div class="progress-bar">
              <div class="progress-fill" :style="{ width: `${(playbackIndex / playbackQueue.length) * 100}%` }"></div>
            </div>
          </div>
        </div>
      </div>
    </Transition>

    <!-- NEW LEGO INTRODUCTION OVERLAY -->
    <Transition name="intro-burst">
      <div v-if="isIntroducingLego && introLego" class="intro-overlay">
        <div class="intro-content">
          <div class="intro-badge">NEW LEGO</div>
          <div class="intro-target">{{ introLego.lego?.target }}</div>
          <div class="intro-known">{{ introLego.lego?.known }}</div>
          <div class="intro-burst"></div>
        </div>
      </div>
    </Transition>

    <!-- Demo Controls (always available for simulation preview) -->
    <div v-if="!isPlaybackMode" class="demo-controls" :class="{ 'with-data': isRealData && nodes.length > 0 }">
      <div class="demo-row">
        <!-- Play/Pause/Stop -->
        <button
          v-if="!isDemoRunning"
          class="demo-btn primary"
          @click="startDemo"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
            <polygon points="5 3 19 12 5 21 5 3"/>
          </svg>
          <span>{{ isRealData && nodes.length > 0 ? 'Preview Growth' : 'Watch it Grow' }}</span>
        </button>
        <button
          v-else
          class="demo-btn danger"
          @click="stopDemo"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
            <rect x="6" y="6" width="12" height="12"/>
          </svg>
          <span>Stop</span>
        </button>

        <!-- Speed controls -->
        <div class="speed-controls">
          <span class="speed-label">Speed:</span>
          <button
            v-for="speed in [1, 2, 4, 8]"
            :key="speed"
            class="speed-btn"
            :class="{ active: demoSpeed === speed }"
            @click="setSpeed(speed)"
          >
            {{ speed }}x
          </button>
        </div>

        <!-- Round counter -->
        <div class="round-counter">
          <span class="round-label">Round</span>
          <span class="round-value">{{ currentRound }}</span>
          <span class="round-max">/ {{ maxRounds }}</span>
        </div>
      </div>

      <!-- Milestone markers -->
      <div class="milestone-track">
        <div class="milestone-bar">
          <div
            class="milestone-progress"
            :style="{ width: `${(currentRound / maxRounds) * 100}%` }"
          ></div>
        </div>
        <div class="milestone-markers">
          <button
            v-for="m in milestones"
            :key="m"
            class="milestone-marker"
            :class="{ reached: reachedMilestones.includes(m), current: currentRound >= m }"
            :style="{ left: `${(m / maxRounds) * 100}%` }"
            @click="jumpToRound(m)"
          >
            {{ m }}
          </button>
        </div>
      </div>

      <!-- Last added LEGO label -->
      <div v-if="lastAddedNode && isDemoRunning" class="last-added">
        <span class="last-added-label">Just learned:</span>
        <span class="last-added-target">{{ lastAddedNode.targetText }}</span>
        <span class="last-added-known">({{ lastAddedNode.knownText }})</span>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="isLoading" class="loading">
      <div class="loading-spinner"></div>
      <p>Loading network...</p>
    </div>

    <!-- Network Viewport -->
    <div v-else class="network-viewport" ref="containerRef" @click="closePanel">
      <svg class="network-svg" ref="svgRef"></svg>

      <!-- Empty state -->
      <div v-if="nodes.length === 0 && !isDemoRunning" class="empty-state">
        <div class="empty-icon">🧠</div>
        <p v-if="isRealData">Start learning to see your brain map grow</p>
        <p v-else>Press "Watch it Grow" to preview the learning journey</p>
      </div>

      <!-- Zoom Controls -->
      <div class="zoom-controls">
        <button class="zoom-btn" @click.stop="zoomIn" title="Zoom in">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/>
            <path d="M21 21l-4.35-4.35M11 8v6M8 11h6"/>
          </svg>
        </button>
        <div class="zoom-level">{{ Math.round(currentZoom * 100) }}%</div>
        <button class="zoom-btn" @click.stop="zoomOut" title="Zoom out">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/>
            <path d="M21 21l-4.35-4.35M8 11h6"/>
          </svg>
        </button>
        <button class="zoom-btn reset" @click.stop="zoomReset" title="Reset view">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
            <path d="M3 3v5h5"/>
          </svg>
        </button>
        <div class="zoom-hint">Scroll to zoom<br/>Drag to pan</div>
      </div>

      <!-- Tooltip -->
      <div
        class="node-tooltip"
        :class="{ visible: hoveredNode && !isPanelOpen }"
        :style="tooltipPosition"
      >
        <span class="tooltip-target">{{ hoveredNode?.targetText }}</span>
        <span class="tooltip-known">{{ hoveredNode?.knownText }}</span>
        <span class="tooltip-practices">{{ hoveredNode?.totalPractices }} practices</span>
      </div>
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
      </div>
    </div>

    <!-- Legend -->
    <div class="network-legend">
      <div class="legend-title">Node Color = Belt When Learned</div>
      <div class="legend-belts">
        <span
          v-for="belt in ['white', 'yellow', 'orange', 'green', 'blue', 'purple', 'brown', 'black']"
          :key="belt"
          class="legend-belt-dot"
          :style="{ background: beltPalettes[belt].glow }"
          :title="beltPalettes[belt].name"
        ></span>
      </div>
      <div class="legend-subtitle">Links = Current Progress</div>
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

/* Header */
.network-header {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 1.25rem 1.5rem;
  z-index: 10;
  background: linear-gradient(180deg, #0a0a0c 0%, transparent 100%);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.back-btn {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  color: rgba(255, 255, 255, 0.6);
  cursor: pointer;
  transition: all 0.2s;
}

.back-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: white;
}

.back-btn svg {
  width: 20px;
  height: 20px;
}

.network-title {
  font-size: 1.5rem;
  font-weight: 600;
  color: white;
  margin: 0;
}

.network-subtitle {
  font-size: 0.875rem;
  color: rgba(255, 255, 255, 0.5);
  margin: 0.25rem 0 0;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 2rem;
}

.belt-indicator {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 20px;
  transition: all 0.3s ease;
}

.belt-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: currentColor;
}

.belt-indicator.white { color: #ffffff; }
.belt-indicator.yellow { color: #fbbf24; }
.belt-indicator.orange { color: #f97316; }
.belt-indicator.green { color: #22c55e; }
.belt-indicator.blue { color: #3b82f6; }
.belt-indicator.purple { color: #8b5cf6; }
.belt-indicator.brown { color: #b45309; }
.belt-indicator.black { color: #d4a853; }

.belt-name {
  font-size: 0.8125rem;
  font-weight: 500;
}

.stats-group {
  display: flex;
  gap: 1.5rem;
}

.stat {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.stat-value {
  font-family: 'JetBrains Mono', monospace;
  font-size: 1.25rem;
  font-weight: 600;
  color: white;
}

.stat-label {
  font-size: 0.625rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: rgba(255, 255, 255, 0.4);
}

/* Data Mode Indicator (Real Data) */
.data-mode-indicator {
  position: absolute;
  top: 80px;
  left: 1.5rem;
  right: 1.5rem;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.875rem 1.25rem;
  background: rgba(34, 197, 94, 0.1);
  border: 1px solid rgba(34, 197, 94, 0.3);
  border-radius: 10px;
  backdrop-filter: blur(8px);
}

.data-mode-badge {
  padding: 0.375rem 0.75rem;
  border-radius: 6px;
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.data-mode-badge.real {
  background: rgba(34, 197, 94, 0.2);
  color: #4ade80;
  border: 1px solid rgba(34, 197, 94, 0.4);
}

.data-mode-badge.empty {
  background: rgba(251, 191, 36, 0.2);
  color: #fbbf24;
  border: 1px solid rgba(251, 191, 36, 0.4);
}

.data-mode-indicator.empty {
  background: rgba(251, 191, 36, 0.1);
  border-color: rgba(251, 191, 36, 0.3);
}

.data-mode-info {
  font-size: 0.875rem;
  color: rgba(255, 255, 255, 0.6);
}

/* Demo controls positioning when showing real data */
.demo-controls.with-data {
  top: 130px;
}

/* Demo Controls */
.demo-controls {
  position: absolute;
  top: 80px;
  left: 1.5rem;
  right: 1.5rem;
  z-index: 10;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.demo-row {
  display: flex;
  align-items: center;
  gap: 1.5rem;
}

.demo-btn {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.625rem 1rem;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 8px;
  color: white;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.demo-btn:hover {
  background: rgba(255, 255, 255, 0.12);
  border-color: rgba(255, 255, 255, 0.25);
}

.demo-btn.primary {
  background: rgba(34, 197, 94, 0.2);
  border-color: rgba(34, 197, 94, 0.4);
  color: #4ade80;
}

.demo-btn.primary:hover {
  background: rgba(34, 197, 94, 0.3);
}

.demo-btn.danger {
  background: rgba(239, 68, 68, 0.2);
  border-color: rgba(239, 68, 68, 0.4);
  color: #f87171;
}

.demo-btn.danger:hover {
  background: rgba(239, 68, 68, 0.3);
}

.demo-btn svg {
  width: 14px;
  height: 14px;
}

.speed-controls {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.speed-label {
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.5);
}

.speed-btn {
  padding: 0.375rem 0.625rem;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  color: rgba(255, 255, 255, 0.6);
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.75rem;
  cursor: pointer;
  transition: all 0.15s;
}

.speed-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: white;
}

.speed-btn.active {
  background: rgba(59, 130, 246, 0.3);
  border-color: rgba(59, 130, 246, 0.5);
  color: #60a5fa;
}

.round-counter {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  margin-left: auto;
}

.round-label {
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.5);
}

.round-value {
  font-family: 'JetBrains Mono', monospace;
  font-size: 1.5rem;
  font-weight: 600;
  color: white;
}

.round-max {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.875rem;
  color: rgba(255, 255, 255, 0.4);
}

/* Milestone Track */
.milestone-track {
  position: relative;
  width: 100%;
  padding: 1rem 0;
}

.milestone-bar {
  height: 4px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
  overflow: hidden;
}

.milestone-progress {
  height: 100%;
  background: linear-gradient(90deg, #22c55e, #3b82f6, #8b5cf6);
  border-radius: 2px;
  transition: width 0.3s ease;
}

.milestone-markers {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 100%;
  pointer-events: none;
}

.milestone-marker {
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  padding: 0.25rem 0.5rem;
  background: rgba(20, 20, 30, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 4px;
  color: rgba(255, 255, 255, 0.5);
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.625rem;
  cursor: pointer;
  pointer-events: auto;
  transition: all 0.2s;
}

.milestone-marker:hover {
  background: rgba(40, 40, 60, 0.95);
  border-color: rgba(255, 255, 255, 0.4);
  color: white;
}

.milestone-marker.current {
  border-color: rgba(59, 130, 246, 0.6);
  color: #60a5fa;
}

.milestone-marker.reached {
  background: rgba(34, 197, 94, 0.2);
  border-color: rgba(34, 197, 94, 0.5);
  color: #4ade80;
}

/* Last Added Label */
.last-added {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  background: rgba(212, 168, 83, 0.1);
  border: 1px solid rgba(212, 168, 83, 0.3);
  border-radius: 8px;
  animation: fadeIn 0.3s ease;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}

.last-added-label {
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.5);
}

.last-added-target {
  font-size: 1rem;
  font-weight: 600;
  color: #d4a853;
}

.last-added-known {
  font-size: 0.875rem;
  color: rgba(255, 255, 255, 0.5);
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

/* Viewport */
.network-viewport {
  position: absolute;
  inset: 0;
  padding-top: 180px;
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

/* Zoom Controls */
.zoom-controls {
  position: absolute;
  bottom: 1.5rem;
  right: 1.5rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  background: rgba(18, 18, 26, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  padding: 0.75rem;
  z-index: 20;
  backdrop-filter: blur(8px);
}

.zoom-btn {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  color: rgba(255, 255, 255, 0.6);
  cursor: pointer;
  transition: all 0.2s;
}

.zoom-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.2);
  color: white;
}

.zoom-btn:active {
  transform: scale(0.95);
}

.zoom-btn svg {
  width: 18px;
  height: 18px;
}

.zoom-btn.reset {
  margin-top: 0.25rem;
  background: rgba(59, 130, 246, 0.15);
  border-color: rgba(59, 130, 246, 0.3);
  color: #60a5fa;
}

.zoom-btn.reset:hover {
  background: rgba(59, 130, 246, 0.25);
  border-color: rgba(59, 130, 246, 0.5);
}

.zoom-level {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.6875rem;
  color: rgba(255, 255, 255, 0.5);
  min-width: 40px;
  text-align: center;
}

.zoom-hint {
  font-size: 0.625rem;
  color: rgba(255, 255, 255, 0.35);
  text-align: center;
  line-height: 1.4;
  margin-top: 0.25rem;
  padding-top: 0.5rem;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
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

/* Legend */
.network-legend {
  position: absolute;
  bottom: 1.5rem;
  left: 1.5rem;
  background: rgba(18, 18, 26, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  padding: 0.875rem 1rem;
  z-index: 10;
  backdrop-filter: blur(8px);
}

.legend-title {
  font-size: 0.625rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgba(255, 255, 255, 0.5);
  margin-bottom: 0.5rem;
}

.legend-belts {
  display: flex;
  gap: 0.375rem;
  margin-bottom: 0.5rem;
}

.legend-belt-dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  box-shadow: 0 0 6px currentColor;
  cursor: help;
  transition: transform 0.15s ease;
}

.legend-belt-dot:hover {
  transform: scale(1.3);
}

.legend-subtitle {
  font-size: 0.5625rem;
  color: rgba(255, 255, 255, 0.35);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

/* ============================================================================
   BRAIN VIEW PLAYBACK MODE STYLES
   ============================================================================ */

/* Playback Controls - Bottom center, above nav bar */
.playback-controls {
  position: absolute;
  bottom: 6rem; /* Above the 80px nav bar */
  left: 50%;
  transform: translateX(-50%);
  z-index: 20;
  display: flex;
  justify-content: center;
}

.playback-controls.with-data {
  bottom: 6.5rem;
}

.playback-btn {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.875rem 1.5rem;
  border-radius: 50px;
  font-size: 0.9375rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
}

.playback-btn.magic {
  background: linear-gradient(135deg, #8b5cf6 0%, #a855f7 50%, #d946ef 100%);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: white;
  position: relative;
  overflow: hidden;
}

.playback-btn.magic::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, transparent 0%, rgba(255, 255, 255, 0.1) 50%, transparent 100%);
  opacity: 0;
  transition: opacity 0.3s;
}

.playback-btn.magic:hover::before {
  opacity: 1;
}

.playback-btn.magic:hover {
  transform: scale(1.05);
  box-shadow: 0 8px 30px rgba(139, 92, 246, 0.4);
}

.playback-btn.magic:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}

.playback-icon {
  font-size: 1.25rem;
  animation: gentle-pulse 2s ease-in-out infinite;
}

.playback-sparkle {
  font-size: 0.875rem;
  animation: sparkle 1.5s ease-in-out infinite;
}

@keyframes gentle-pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.1); }
}

@keyframes sparkle {
  0%, 100% { opacity: 0.5; transform: rotate(0deg); }
  50% { opacity: 1; transform: rotate(180deg); }
}

.playback-btn.stop {
  background: rgba(239, 68, 68, 0.2);
  border: 1px solid rgba(239, 68, 68, 0.4);
  color: #f87171;
}

.playback-btn.stop:hover {
  background: rgba(239, 68, 68, 0.3);
  box-shadow: 0 8px 30px rgba(239, 68, 68, 0.3);
}

.playback-btn.stop svg {
  width: 16px;
  height: 16px;
}

/* Now Playing Panel - Appears during playback */
.now-playing-panel {
  position: absolute;
  bottom: 10rem; /* Above the playback button and nav bar */
  left: 50%;
  transform: translateX(-50%);
  z-index: 20;
  min-width: 360px;
  max-width: 500px;
  background: rgba(18, 18, 26, 0.95);
  border: 1px solid rgba(139, 92, 246, 0.3);
  border-radius: 16px;
  padding: 1.25rem 1.5rem;
  backdrop-filter: blur(20px);
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.5), 0 0 60px rgba(139, 92, 246, 0.15);
}

.now-playing-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}

.now-playing-label {
  font-size: 0.6875rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: rgba(255, 255, 255, 0.5);
}

.phase-badge {
  padding: 0.375rem 0.875rem;
  border-radius: 20px;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  transition: all 0.3s ease;
}

.phase-badge.idle {
  background: rgba(107, 114, 128, 0.3);
  color: #9ca3af;
}

.phase-badge.prompt {
  background: rgba(59, 130, 246, 0.3);
  border: 1px solid rgba(59, 130, 246, 0.5);
  color: #60a5fa;
  animation: phase-pulse 1s ease-in-out infinite;
}

.phase-badge.pause {
  background: rgba(251, 191, 36, 0.3);
  border: 1px solid rgba(251, 191, 36, 0.5);
  color: #fbbf24;
  animation: phase-pulse 0.6s ease-in-out infinite;
}

.phase-badge.voice_1 {
  background: rgba(34, 197, 94, 0.3);
  border: 1px solid rgba(34, 197, 94, 0.5);
  color: #4ade80;
  animation: phase-pulse 1s ease-in-out infinite;
}

.phase-badge.voice_2 {
  background: rgba(139, 92, 246, 0.3);
  border: 1px solid rgba(139, 92, 246, 0.5);
  color: #a78bfa;
  animation: phase-pulse 1s ease-in-out infinite;
}

@keyframes phase-pulse {
  0%, 100% { box-shadow: 0 0 0 0 currentColor; }
  50% { box-shadow: 0 0 15px currentColor; }
}

/* Phrase Display */
.now-playing-content {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.phrase-display {
  text-align: center;
}

.phrase-target {
  display: block;
  font-size: 1.5rem;
  font-weight: 700;
  color: transparent;
  background: linear-gradient(90deg, rgba(255, 255, 255, 0.15), rgba(255, 255, 255, 0.2));
  -webkit-background-clip: text;
  background-clip: text;
  transition: all 0.5s ease;
  filter: blur(4px);
  margin-bottom: 0.5rem;
  letter-spacing: 0.02em;
}

.phrase-target.revealed {
  color: white;
  background: none;
  filter: blur(0);
  text-shadow: 0 0 30px rgba(139, 92, 246, 0.5);
}

.phrase-known {
  display: block;
  font-size: 1rem;
  color: rgba(255, 255, 255, 0.6);
}

/* Active LEGOs chips */
.active-legos {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  justify-content: center;
}

.lego-chip {
  padding: 0.25rem 0.625rem;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 6px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.6875rem;
  color: rgba(255, 255, 255, 0.6);
  transition: all 0.3s ease;
}

.lego-chip.primary {
  background: rgba(139, 92, 246, 0.2);
  border-color: rgba(139, 92, 246, 0.4);
  color: #a78bfa;
  box-shadow: 0 0 10px rgba(139, 92, 246, 0.3);
}

/* Playback Progress */
.playback-progress {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.progress-text {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.5);
  min-width: 70px;
}

.progress-bar {
  flex: 1;
  height: 4px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #8b5cf6, #d946ef);
  border-radius: 2px;
  transition: width 0.3s ease;
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

/* Responsive */
@media (max-width: 900px) {
  .detail-panel {
    width: 100%;
    height: 60%;
    top: auto;
    bottom: 0;
    transform: translateY(100%);
    border-left: none;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
  }

  .detail-panel.open {
    transform: translateY(0);
  }

  .network-header {
    flex-direction: column;
    gap: 1rem;
    padding: 1rem;
  }

  .header-right {
    width: 100%;
    justify-content: space-between;
  }

  .stats-group {
    gap: 1rem;
  }

  .demo-controls {
    top: 120px;
    left: 1rem;
    right: 1rem;
  }

  .demo-row {
    flex-wrap: wrap;
    gap: 1rem;
  }

  .round-counter {
    margin-left: 0;
  }

  .network-legend {
    bottom: auto;
    top: 260px;
    left: 1rem;
    padding: 0.75rem;
  }

  .legend-items {
    flex-direction: row;
    flex-wrap: wrap;
    gap: 0.75rem;
  }

  .network-viewport {
    padding-top: 280px;
  }

  /* Playback controls responsive */
  .playback-controls {
    bottom: 6rem; /* Above nav bar on mobile too */
    left: 1rem;
    right: 1rem;
    transform: none;
  }

  .playback-btn {
    width: 100%;
    justify-content: center;
    padding: 1rem;
  }

  .now-playing-panel {
    left: 1rem;
    right: 1rem;
    bottom: 10rem; /* Above playback button and nav */
    min-width: auto;
    max-width: none;
    transform: none;
  }

  .phrase-target {
    font-size: 1.25rem;
  }

  .intro-overlay .intro-content {
    padding: 2rem;
  }

  .intro-target {
    font-size: 2rem;
  }

  .intro-known {
    font-size: 1.125rem;
  }
}
</style>
