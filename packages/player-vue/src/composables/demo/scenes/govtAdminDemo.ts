import type { DemoConfig } from '../types'

export const govtAdminDemo: DemoConfig = {
  id: 'govt-admin-demo',
  title: 'SaySomethingin Schools - Group Overview',
  description: 'See how group administrators can monitor language learning across all schools in their area.',
  scenes: [
    {
      id: 'group-dashboard',
      title: 'Group Dashboard',
      narration: 'Gwilym is a group administrator. He sees aggregated data across all schools — total students, practice hours, and class activity. No individual student data is exposed.',
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
      id: 'group-analytics',
      title: 'Analytics →',
      narration: 'Compare school performance and track group language learning goals.',
      route: '/schools/analytics',
      duration: 0,
    },
    {
      id: 'closing',
      title: 'Thank You',
      narration: 'SaySomethingin Schools: real data, real progress, real impact across your group.',
      route: '/schools',
      duration: 0,
    },
  ],
}
