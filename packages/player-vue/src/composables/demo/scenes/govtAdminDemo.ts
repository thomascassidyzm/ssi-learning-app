import type { DemoConfig } from '../types'

const GOVT_USER = 'test_govt_gwilym'

export const govtAdminDemo: DemoConfig = {
  id: 'govt-admin-demo',
  title: 'SaySomethingin Schools - Regional Overview',
  description: 'See how regional administrators can monitor language learning across all schools in their area.',
  scenes: [
    {
      id: 'regional-dashboard',
      title: 'Regional Dashboard',
      narration: 'Gwilym is a regional administrator. He sees aggregated data across all schools — total students, practice hours, and class activity. No individual student data is exposed.',
      godModeUserId: GOVT_USER,
      route: '/schools',
      duration: 0,
    },
    {
      id: 'school-drilldown',
      title: 'School Detail',
      narration: 'Click any school to drill in — see active classes, languages being taught, and how students are progressing through their belts.',
      route: '/schools',
      duration: 0,
      highlight: '.school-card',
    },
    {
      id: 'regional-analytics',
      title: 'Analytics →',
      narration: 'Compare school performance and track regional language learning goals.',
      route: '/schools/analytics',
      duration: 0,
    },
    {
      id: 'closing',
      title: 'Thank You',
      narration: 'SaySomethingin Schools: real data, real progress, real impact across your region.',
      route: '/schools',
      duration: 0,
    },
  ],
}
