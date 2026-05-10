import type { DemoConfig } from '../types'

// Welsh demo data IDs (retained for potential future scene lookups; persona
// is set once by DemoLauncher so scenes no longer carry a user ID).
const CLASS_WELSH_ID = 'e0300000-0000-0000-0000-000000000001'   // Blwyddyn 5 Cymraeg
const CLASS_FRENCH_ID = 'e0300000-0000-0000-0000-000000000004'  // Blwyddyn 6 Ffrangeg

export const teacherDemo: DemoConfig = {
  id: 'teacher-demo',
  title: 'SaySomethingin Schools - Teacher Demo',
  description: 'Walk through the teacher experience: managing classes, running learning sessions, and tracking student progress.',
  scenes: [
    // -- Dashboard (stay on this screen) --
    {
      id: 'welcome',
      title: 'Dashboard',
      narration: 'This is the teacher dashboard. Rhian teaches at Ysgol Gymraeg Aberystwyth — she can see her classes, students, and progress at a glance.',
      route: '/schools',
      duration: 0,
    },
    // -- Navigate to Classes --
    {
      id: 'my-classes',
      title: 'Classes →',
      narration: 'The Classes screen shows all of Rhian\'s classes. She can start a learning session with a single tap.',
      route: '/schools/classes',
      duration: 0,
    },
    // -- Play Welsh class (navigates to player) --
    {
      id: 'play-welsh',
      title: 'Play Welsh →',
      narration: 'Let\'s play a session with Blwyddyn 5\'s Welsh class.',
      action: 'playClass',
      actionDelay: 1000,
      duration: 0,
    },
    // -- On the player screen --
    {
      id: 'learning-cycles-1',
      title: 'Learning Session',
      narration: 'The class hears a prompt in English, pauses to speak in Welsh, then hears the correct answer. Every student speaks every sentence. Press play to try it.',
      duration: 0,
    },
    // -- Back to classes --
    {
      id: 'stop-session',
      title: 'Classes →',
      narration: 'Back to the dashboard. Progress is saved automatically.',
      action: 'stopSession',
      duration: 0,
    },
    // -- Play French class (navigates to player) --
    {
      id: 'play-french',
      title: 'Play French →',
      narration: 'Now Blwyddyn 6\'s French class. Same interface, different language — teachers don\'t need any target language expertise.',
      route: '/schools/classes',
      action: 'playClassSecond',
      actionDelay: 1000,
      duration: 0,
    },
    // -- On the player screen --
    {
      id: 'learning-cycles-2',
      title: 'French Session',
      narration: 'Same experience, different language. The SSi method works for any language — proven over 15 years with thousands of delighted learners.',
      duration: 0,
    },
    // -- Back to dashboard --
    {
      id: 'stop-return',
      title: 'Dashboard →',
      narration: 'Returning to the dashboard.',
      action: 'stopSession',
      duration: 0,
    },
    // -- Class detail (navigates) --
    {
      id: 'class-detail',
      title: 'Class Detail →',
      narration: 'Drill into any class to see the roster, individual student progress, and session history.',
      action: 'showClassDetail',
      duration: 0,
    },
    // -- Analytics (navigates) --
    {
      id: 'analytics',
      title: 'Analytics →',
      narration: 'Rich analytics show learning patterns, belt progression, and class comparisons.',
      route: '/schools/analytics',
      duration: 0,
    },
    // -- Closing (stay on dashboard) --
    {
      id: 'closing',
      title: 'Thank You',
      narration: 'SaySomethingin Schools: the simplest way to bring language learning to life in your classroom. Built on 15 years of proven methodology.',
      route: '/schools',
      duration: 0,
    },
  ],
}
