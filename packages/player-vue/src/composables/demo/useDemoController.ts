/**
 * useDemoController - Singleton composable for interactive demo mode
 *
 * Manages demo lifecycle: scene transitions, God Mode impersonation,
 * route navigation, named actions, and keyboard controls.
 *
 * Demo state is ephemeral — nothing persists to localStorage.
 */

import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useGodMode } from '@/composables/schools/useGodMode'
import type { DemoScene, DemoConfig, DemoState } from './types'
import { teacherDemo } from './scenes/teacherDemo'
import { govtAdminDemo } from './scenes/govtAdminDemo'

// ---- Demo registry ----
const demoRegistry: Record<string, DemoConfig> = {
  'teacher-demo': teacherDemo,
  'govt-admin-demo': govtAdminDemo,
}

// ---- Shared singleton state ----
const isActive = ref(false)
const isPaused = ref(false)
const currentSceneIndex = ref(0)
const activeDemoId = ref<string | null>(null)
const activeDemo = ref<DemoConfig | null>(null)

// Timer handle for auto-advance
let sceneTimer: ReturnType<typeof setTimeout> | null = null

// Track whether keyboard listener is bound
let keyboardBound = false

export function useDemoController() {
  const router = useRouter()
  const godMode = useGodMode()

  // ---- Computed ----

  const currentScene = computed<DemoScene | null>(() => {
    if (!activeDemo.value) return null
    return activeDemo.value.scenes[currentSceneIndex.value] ?? null
  })

  const totalScenes = computed(() => {
    return activeDemo.value?.scenes.length ?? 0
  })

  const progress = computed(() => {
    if (totalScenes.value === 0) return 0
    return (currentSceneIndex.value + 1) / totalScenes.value
  })

  const state = computed<DemoState>(() => ({
    isActive: isActive.value,
    isPaused: isPaused.value,
    currentSceneIndex: currentSceneIndex.value,
    demoId: activeDemoId.value,
    progress: progress.value,
  }))

  // ---- Timer management ----

  function clearSceneTimer() {
    if (sceneTimer !== null) {
      clearTimeout(sceneTimer)
      sceneTimer = null
    }
  }

  function startSceneTimer(duration: number) {
    clearSceneTimer()
    if (duration <= 0) return
    sceneTimer = setTimeout(() => {
      if (!isPaused.value && isActive.value) {
        nextScene()
      }
    }, duration)
  }

  // ---- God Mode helpers ----

  /**
   * Wait for God Mode users to be fetched (by GodModePanel on /schools mount).
   * Returns true if users loaded within timeout, false otherwise.
   */
  function waitForGodModeUsers(timeoutMs = 5000): Promise<boolean> {
    return new Promise((resolve) => {
      if (godMode.allUsers.value.length > 0) {
        resolve(true)
        return
      }
      const interval = setInterval(() => {
        if (godMode.allUsers.value.length > 0) {
          clearInterval(interval)
          resolve(true)
        }
      }, 200)
      setTimeout(() => {
        clearInterval(interval)
        resolve(godMode.allUsers.value.length > 0)
      }, timeoutMs)
    })
  }

  // ---- Named actions ----

  /**
   * Execute a named action. These replicate the programmatic logic from
   * the real components (e.g., TeacherDashboard.handlePlayClass) rather
   * than trying to click DOM elements.
   */
  async function executeAction(actionName: string) {
    switch (actionName) {
      case 'playClass':
        await playClassByIndex(0)
        break

      case 'playClassSecond':
        await playClassByIndex(1)
        break

      case 'pausePlayer': {
        // Dispatch a custom event that the LearningPlayer can listen for
        window.dispatchEvent(new CustomEvent('demo:pausePlayer'))
        break
      }

      case 'stopSession':
        // Clear active class and navigate back to classes
        localStorage.removeItem('ssi-active-class')
        await router.push({ path: '/schools/classes' })
        break

      case 'showClassDetail': {
        // Navigate to the first class detail using the Welsh class ID
        const welshClassId = 'e0300000-0000-0000-0000-000000000001'
        await router.push({ name: 'class-detail', params: { id: welshClassId } })
        break
      }

      case 'expandAnalytics':
        // Dispatch a custom event for the analytics view to handle
        window.dispatchEvent(new CustomEvent('demo:expandAnalytics'))
        break

      default:
        console.warn(`[DemoController] Unknown action: ${actionName}`)
    }
  }

  /**
   * Replicate TeacherDashboard.handlePlayClass logic programmatically.
   * Reads class data from the classes list and stores it in localStorage
   * before navigating to the player.
   */
  async function playClassByIndex(index: number) {
    // Class IDs and metadata for the demo
    // Welsh uses cym_s (South) as the default demo variant
    const demoClasses = [
      {
        id: 'e0300000-0000-0000-0000-000000000001',
        name: 'Blwyddyn 5 Cymraeg',
        course_code: 'cym_s_for_eng',
        target_lang: 'cym_s',
        current_seed: 1,
        last_lego_id: null,
      },
      {
        id: 'e0300000-0000-0000-0000-000000000004',
        name: 'Blwyddyn 6 Ffrangeg',
        course_code: 'fra_for_eng',
        target_lang: 'fra',
        current_seed: 1,
        last_lego_id: null,
      },
    ]

    const cls = demoClasses[index]
    if (!cls) {
      console.warn(`[DemoController] No demo class at index ${index}`)
      return
    }

    // Simple approach: set localStorage, navigate, let PlayerContainer handle course switch.
    // PlayerContainer already reads class context and calls handleCourseSelect internally.
    localStorage.setItem('ssi-last-course', cls.course_code)
    localStorage.setItem('ssi-active-class', JSON.stringify({
      id: cls.id,
      name: cls.name,
      course_code: cls.course_code,
      current_seed: cls.current_seed,
      last_lego_id: cls.last_lego_id,
      teacherUserId: godMode.selectedUser.value?.user_id,
      timestamp: new Date().toISOString(),
    }))

    // Full page navigation forces PlayerContainer to re-mount and read the class context fresh
    window.location.href = `/?class=${cls.id}`
  }

  // ---- Scene transition ----

  async function applyScene(scene: DemoScene) {
    clearSceneTimer()

    // Step 1: God Mode impersonation (wait for users if needed)
    if (scene.godModeUserId) {
      if (godMode.allUsers.value.length === 0) {
        await waitForGodModeUsers()
      }
      const users = godMode.allUsers.value
      const targetUser = users.find(u => u.user_id === scene.godModeUserId)
      if (targetUser) {
        godMode.selectUser(targetUser)
      } else {
        console.warn(`[DemoController] God Mode user not found: ${scene.godModeUserId}. Available: ${users.length} users`)
      }
    }

    // Step 2: Route navigation
    if (scene.route) {
      await router.push({ path: scene.route, query: scene.routeQuery })
      // Give Vue a tick to render the new route
      await nextTick()
    }

    // Step 3: Execute named action (after optional delay)
    if (scene.action) {
      const delay = scene.actionDelay ?? 0
      if (delay > 0) {
        setTimeout(() => {
          if (isActive.value) {
            executeAction(scene.action!)
          }
        }, delay)
      } else {
        await executeAction(scene.action)
      }
    }

    // Step 4: Auto-advance only if scene explicitly opts in (autoAdvance: true)
    // Default is manual click-through — each scene is fully interactive
    if (scene.autoAdvance === true && scene.duration > 0 && !isPaused.value) {
      startSceneTimer(scene.duration)
    }
  }

  // ---- Public API ----

  async function startDemo(demoId: string) {
    const config = demoRegistry[demoId]
    if (!config) {
      console.error(`[DemoController] Unknown demo: ${demoId}`)
      return
    }

    activeDemo.value = config
    activeDemoId.value = demoId
    currentSceneIndex.value = 0
    isPaused.value = false
    isActive.value = true

    bindKeyboard()

    const scene = config.scenes[0]
    if (scene) {
      await applyScene(scene)
    }
  }

  function stopDemo() {
    clearSceneTimer()
    isActive.value = false
    isPaused.value = false
    currentSceneIndex.value = 0
    activeDemoId.value = null
    activeDemo.value = null
    unbindKeyboard()

    // Clean up any demo state
    localStorage.removeItem('ssi-active-class')
    localStorage.removeItem('ssi-dev-tier')
    localStorage.removeItem('ssi-last-course')
    delete (window as any).__demoSelectCourse

    // Navigate back to demo launcher
    router.push('/demo')
  }

  function pause() {
    if (!isActive.value) return
    isPaused.value = true
    clearSceneTimer()
  }

  function resume() {
    if (!isActive.value || !isPaused.value) return
    isPaused.value = false

    // Restart the timer for the current scene with remaining time
    // For simplicity, restart with full duration (good enough for demo)
    const scene = currentScene.value
    if (scene && scene.duration > 0 && scene.autoAdvance !== false) {
      startSceneTimer(scene.duration)
    }
  }

  function togglePause() {
    if (isPaused.value) {
      resume()
    } else {
      pause()
    }
  }

  async function nextScene() {
    if (!activeDemo.value) return
    const nextIndex = currentSceneIndex.value + 1
    if (nextIndex >= activeDemo.value.scenes.length) {
      // Demo complete
      stopDemo()
      return
    }

    currentSceneIndex.value = nextIndex
    const scene = activeDemo.value.scenes[nextIndex]
    if (scene) {
      await applyScene(scene)
    }
  }

  async function prevScene() {
    if (!activeDemo.value) return
    const prevIndex = currentSceneIndex.value - 1
    if (prevIndex < 0) return

    currentSceneIndex.value = prevIndex
    const scene = activeDemo.value.scenes[prevIndex]
    if (scene) {
      await applyScene(scene)
    }
  }

  async function goToScene(index: number) {
    if (!activeDemo.value) return
    if (index < 0 || index >= activeDemo.value.scenes.length) return

    currentSceneIndex.value = index
    const scene = activeDemo.value.scenes[index]
    if (scene) {
      await applyScene(scene)
    }
  }

  // ---- Keyboard handling ----

  function handleKeydown(event: KeyboardEvent) {
    if (!isActive.value) return

    // Don't capture if user is typing in an input
    const target = event.target as HTMLElement
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
      return
    }

    switch (event.code) {
      case 'ArrowRight':
        event.preventDefault()
        nextScene()
        break
      case 'ArrowLeft':
        event.preventDefault()
        prevScene()
        break
      case 'Escape':
        event.preventDefault()
        stopDemo()
        break
    }
  }

  function bindKeyboard() {
    if (keyboardBound) return
    window.addEventListener('keydown', handleKeydown)
    keyboardBound = true
  }

  function unbindKeyboard() {
    if (!keyboardBound) return
    window.removeEventListener('keydown', handleKeydown)
    keyboardBound = false
  }

  // ---- Helpers ----

  function getAvailableDemos(): DemoConfig[] {
    return Object.values(demoRegistry)
  }

  function getDemoById(id: string): DemoConfig | undefined {
    return demoRegistry[id]
  }

  return {
    // Reactive state
    isActive,
    isPaused,
    currentScene,
    currentSceneIndex,
    totalScenes,
    progress,
    state,
    activeDemo,
    activeDemoId,

    // Lifecycle
    startDemo,
    stopDemo,
    pause,
    resume,
    togglePause,
    nextScene,
    prevScene,
    goToScene,

    // Registry
    getAvailableDemos,
    getDemoById,
  }
}
