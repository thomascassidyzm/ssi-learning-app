import type { DemoConfig } from '../types'

const GOVT_USER = 'test_govt_gwilym'

export const govtAdminDemo: DemoConfig = {
  id: 'govt-admin-demo',
  title: 'SaySomethingin Schools - Regional Overview',
  description: 'See how regional administrators can monitor language learning across all schools in their area.',
  scenes: [
    {
      id: 'welcome',
      title: 'Welcome',
      narration: 'SaySomethingin Schools: empowering regional language education with real-time data across every school.',
      route: '/schools',
      duration: 5000,
    },
    {
      id: 'govt-login',
      title: 'Govt Login',
      narration: 'Gwilym has logged in as a regional administrator. He sees aggregated data across all schools in his region.',
      godModeUserId: GOVT_USER,
      route: '/schools',
      duration: 4000,
    },
    {
      id: 'regional-dashboard',
      title: 'Regional Dashboard',
      narration: 'Regional administrators see aggregated data across all schools — total students, practice hours, and class activity. No individual student data is exposed at this level, respecting privacy while enabling oversight.',
      route: '/schools',
      duration: 8000,
    },
    {
      id: 'school-drilldown',
      title: 'School Detail',
      narration: 'Drill into any school to see detailed progress — how many classes are active, which languages are being taught, and how students are advancing through their belts.',
      route: '/schools',
      duration: 6000,
      highlight: '.school-card',
    },
    {
      id: 'regional-analytics',
      title: 'Regional Analytics',
      narration: 'Compare school performance, track regional language learning goals, and identify schools that might need additional support — all from one clear dashboard.',
      route: '/schools/analytics',
      duration: 8000,
    },
    {
      id: 'closing',
      title: 'Thank You',
      narration: 'SaySomethingin Schools: empowering language education at scale. Real data, real progress, real impact across your region.',
      route: '/schools',
      duration: 6000,
    },
  ],
}
