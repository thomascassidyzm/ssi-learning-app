import type { DemoConfig } from '../types'

// Welsh demo data IDs
const TEACHER_USER = 'test_teacher_rhian'
const CLASS_WELSH_ID = 'e0300000-0000-0000-0000-000000000001'   // Blwyddyn 5 Cymraeg
const CLASS_FRENCH_ID = 'e0300000-0000-0000-0000-000000000004'  // Blwyddyn 6 Ffrangeg

export const teacherDemo: DemoConfig = {
  id: 'teacher-demo',
  title: 'SaySomethingin Schools - Teacher Demo',
  description: 'Walk through the teacher experience: managing classes, running learning sessions, and tracking student progress.',
  scenes: [
    {
      id: 'welcome',
      title: 'Welcome',
      narration: 'Welcome to SaySomethingin Schools — the simplest way to bring language learning to life in your classroom.',
      route: '/schools',
      duration: 5000,
    },
    {
      id: 'teacher-login',
      title: 'Teacher Login',
      narration: 'Rhian has just logged in as a teacher at Ysgol Gymraeg Aberystwyth. The dashboard loads instantly with her classes and data.',
      godModeUserId: TEACHER_USER,
      route: '/schools',
      duration: 4000,
    },
    {
      id: 'dashboard-overview',
      title: 'Dashboard',
      narration: 'The teacher dashboard shows an overview of classes, students, and learning progress — everything Rhian needs at a glance.',
      route: '/schools',
      duration: 6000,
    },
    {
      id: 'my-classes',
      title: 'My Classes',
      narration: 'Rhian can see all her classes and start a learning session with a single tap. No setup, no fuss.',
      route: '/schools/classes',
      duration: 5000,
    },
    {
      id: 'play-welsh',
      title: 'Play Welsh',
      narration: "Let's play a session with Blwyddyn 5's Welsh class. One tap and the whole class is learning together.",
      route: '/schools/classes',
      action: 'playClass',
      actionDelay: 2000,
      duration: 4000,
    },
    {
      id: 'learning-cycles-1',
      title: 'Learning Session',
      narration: 'The learning player guides the class through speaking exercises. Listen to the prompt, pause to speak, then hear the correct answer. Every student speaks every sentence.',
      duration: 15000,
    },
    {
      id: 'pause-demo',
      title: 'Pause',
      narration: 'Teachers can pause anytime to discuss a phrase, practise pronunciation, or answer questions. The session picks up exactly where it left off.',
      action: 'pausePlayer',
      duration: 5000,
    },
    {
      id: 'stop-session',
      title: 'Back to Dashboard',
      narration: "Back to the dashboard — progress is saved automatically. Let's try another class.",
      action: 'stopSession',
      duration: 4000,
    },
    {
      id: 'play-french',
      title: 'Play French',
      narration: "Now let's try Blwyddyn 6's French class. Same simple interface, different language — teachers don't need any target language expertise.",
      route: '/schools/classes',
      action: 'playClassSecond',
      actionDelay: 2000,
      duration: 4000,
    },
    {
      id: 'learning-cycles-2',
      title: 'French Session',
      narration: 'Same intuitive experience, different language. The SSi method works for any language — proven over 15 years with over a million learners worldwide.',
      duration: 12000,
    },
    {
      id: 'stop-return',
      title: 'Stop Session',
      narration: 'Returning to the dashboard.',
      action: 'stopSession',
      duration: 3000,
    },
    {
      id: 'class-detail',
      title: 'Class Detail',
      narration: 'Teachers can drill into any class to see the roster, individual student progress, and session history.',
      action: 'showClassDetail',
      duration: 6000,
    },
    {
      id: 'analytics',
      title: 'Analytics',
      narration: 'Rich analytics show learning patterns, belt progression, and class comparisons — giving teachers real insight into how their students are progressing.',
      route: '/schools/analytics',
      duration: 8000,
    },
    {
      id: 'closing',
      title: 'Thank You',
      narration: 'SaySomethingin Schools: the simplest way to bring language learning to life in your classroom. Built on 15 years of proven methodology, used by over a million learners.',
      route: '/schools',
      duration: 6000,
    },
  ],
}
