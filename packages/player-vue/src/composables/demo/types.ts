export interface DemoScene {
  id: string
  title: string           // Short title shown in progress bar
  narration: string       // Explanatory text shown in overlay
  route?: string          // Vue Router path to navigate to
  routeQuery?: Record<string, string>  // Query params
  duration: number        // ms to stay on this scene (0 = manual advance only)
  autoAdvance?: boolean   // auto-advance when duration expires (default true)
  highlight?: string      // CSS selector to highlight/spotlight
  action?: string         // named action the controller should execute
  actionDelay?: number    // ms to wait before executing action
}

export interface DemoConfig {
  id: string
  title: string
  description: string
  scenes: DemoScene[]
}

export interface DemoState {
  isActive: boolean
  isPaused: boolean
  currentSceneIndex: number
  demoId: string | null
  progress: number        // 0-1
}
