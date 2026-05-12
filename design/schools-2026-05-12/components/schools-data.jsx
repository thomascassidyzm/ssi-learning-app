/* Demo data for SSi Schools — Skol Diwan Kemper.
   All names, codes and numbers are illustrative; structures match
   what the live Vue app expects so screens read like real product. */

window.SSI_TEACHER = {
  id: 't-erwan',
  name: 'Erwan Le Bihan',
  initials: 'EL',
  role: 'teacher',
  school: 'Skol Diwan Kemper',
  region: 'Brittany',
  email: 'erwan.lebihan@diwan-kemper.bzh',
};

window.SSI_ADMIN = {
  id: 't-yannig',
  name: 'Yannig Pelleau',
  initials: 'YP',
  role: 'admin',
  school: 'Skol Diwan Kemper',
  region: 'Brittany',
  email: 'yannig.pelleau@diwan-kemper.bzh',
};

window.SSI_GOVT = {
  id: 'g-bzh',
  name: 'Loig Caradec',
  initials: 'LC',
  role: 'govt',
  school: 'Brittany Education Authority',
  region: 'Brittany',
  email: 'loig.caradec@brittany.gov.bzh',
};

window.SSI_SCHOOL = {
  id: 'sch-kmp',
  name: 'Skol Diwan Kemper',
  region: 'Brittany',
  type: 'Bilingual immersion · primary + lower secondary',
  joined: '2024-09-12',
  students: 312,
  teachers: 18,
  classes: 14,
  active7d: 271,
  hoursWk: 92.4,
};

window.SSI_CLASSES = [
  {
    id: 'cm1', name: 'CM1 Brezhoneg', course: 'Welsh North · Level 1',
    teacher: 'Erwan Le Bihan', teacherId: 't-erwan', students: 20,
    classBelt: 'yellow',
    beltDist: { white: 3, yellow: 12, orange: 5 },
    journey: { done: 18, total: 60 },
    bench: { class: 62, school: 54, course: 49 },
    hoursWk: 6.4, sessionsWk: 38, avgMins: 18,
    activity: [3,4,4,5,6,5,7],
    joinCode: 'KMP-7Q3X',
    needs: '3 new students this week',
    health: 'good',
  },
  {
    id: '5eme', name: '5ème Brezhoneg', course: 'Welsh North · Level 2',
    teacher: 'Erwan Le Bihan', teacherId: 't-erwan', students: 20,
    classBelt: 'orange',
    beltDist: { yellow: 4, orange: 13, green: 3 },
    journey: { done: 34, total: 60 },
    bench: { class: 88, school: 54, course: 49 },
    hoursWk: 11.2, sessionsWk: 51, avgMins: 24,
    activity: [7,8,9,8,9,7,9],
    joinCode: 'KMP-M4P2',
    needs: 'Strong week — 9 retired LEGOs',
    health: 'excellent',
  },
  {
    id: 'spa', name: '4ème Español', course: 'Spanish · Level 1',
    teacher: 'Erwan Le Bihan', teacherId: 't-erwan', students: 14,
    classBelt: 'white',
    beltDist: { white: 9, yellow: 5 },
    journey: { done: 7, total: 60 },
    bench: { class: 32, school: 54, course: 49 },
    hoursWk: 2.8, sessionsWk: 14, avgMins: 14,
    activity: [2,1,3,2,2,1,3],
    joinCode: 'KMP-D9LR',
    needs: 'Two students inactive 14+ days',
    health: 'needs-attention',
  },
  // Other teachers — school-wide roster
  { id:'cp-br',   name:'CP Brezhoneg',     course:'Welsh North · Level 1', teacher:'Mona Riou',     teacherId:'t-mona',   students:18, classBelt:'white',  beltDist:{white:14,yellow:4},       journey:{done:9, total:60},  bench:{class:48,school:54,course:49}, hoursWk:4.8, sessionsWk:28, avgMins:14, activity:[3,3,4,4,3,2,4], joinCode:'KMP-A1BC', needs:'On track',                          health:'good' },
  { id:'ce1-br',  name:'CE1 Brezhoneg',    course:'Welsh North · Level 1', teacher:'Mona Riou',     teacherId:'t-mona',   students:18, classBelt:'yellow', beltDist:{white:5,yellow:11,orange:2},journey:{done:15,total:60},  bench:{class:55,school:54,course:49}, hoursWk:5.6, sessionsWk:32, avgMins:16, activity:[4,4,5,4,5,3,5], joinCode:'KMP-Q8WE', needs:'Steady',                            health:'good' },
  { id:'ce2-br',  name:'CE2 Brezhoneg',    course:'Welsh North · Level 1', teacher:'Erwan Le Bihan',teacherId:'t-erwan',  students:19, classBelt:'yellow', beltDist:{white:4,yellow:13,orange:2},journey:{done:17,total:60},  bench:{class:60,school:54,course:49}, hoursWk:6.0, sessionsWk:36, avgMins:17, activity:[4,5,5,5,6,4,6], joinCode:'KMP-X3YZ', needs:'Strong week',                       health:'excellent' },
  { id:'cm2-br',  name:'CM2 Brezhoneg',    course:'Welsh North · Level 2', teacher:'Mona Riou',     teacherId:'t-mona',   students:18, classBelt:'orange', beltDist:{yellow:5,orange:11,green:2},journey:{done:30,total:60},  bench:{class:71,school:54,course:49}, hoursWk:8.6, sessionsWk:42, avgMins:20, activity:[6,6,7,6,7,5,7], joinCode:'KMP-MN4P', needs:'On track',                          health:'good' },
  { id:'6e-br',   name:'6ème Brezhoneg',   course:'Welsh North · Level 2', teacher:'Erwan Le Bihan',teacherId:'t-erwan',  students:21, classBelt:'orange', beltDist:{yellow:6,orange:13,green:2},journey:{done:28,total:60},  bench:{class:67,school:54,course:49}, hoursWk:8.1, sessionsWk:40, avgMins:20, activity:[5,6,7,6,7,5,7], joinCode:'KMP-T2HG', needs:'Steady',                            health:'good' },
  { id:'4e-br',   name:'4ème Brezhoneg',   course:'Welsh North · Level 3', teacher:'Yannig Pelleau',teacherId:'t-yannig', students:18, classBelt:'green',  beltDist:{orange:6,green:10,blue:2},   journey:{done:46,total:60},  bench:{class:78,school:54,course:49}, hoursWk:9.4, sessionsWk:45, avgMins:21, activity:[6,7,7,7,8,6,7], joinCode:'KMP-V7KL', needs:'Top performing class',              health:'excellent' },
  { id:'3e-br',   name:'3ème Brezhoneg',   course:'Welsh North · Level 3', teacher:'Yannig Pelleau',teacherId:'t-yannig', students:17, classBelt:'green',  beltDist:{orange:4,green:11,blue:2},   journey:{done:48,total:60},  bench:{class:80,school:54,course:49}, hoursWk:9.6, sessionsWk:46, avgMins:21, activity:[7,7,8,7,8,6,8], joinCode:'KMP-R5DS', needs:'2 students close to blue belt',     health:'excellent' },
  { id:'ce2-en',  name:'CE2 English',      course:'English · Level 1',     teacher:'Soazig Toudic', teacherId:'t-soaz',   students:20, classBelt:'white',  beltDist:{white:11,yellow:9},          journey:{done:8, total:60},  bench:{class:42,school:54,course:49}, hoursWk:3.6, sessionsWk:22, avgMins:13, activity:[3,3,3,4,3,2,3], joinCode:'KMP-EN1A', needs:'Below school average',               health:'needs-attention' },
  { id:'cm1-en',  name:'CM1 English',      course:'English · Level 1',     teacher:'Soazig Toudic', teacherId:'t-soaz',   students:20, classBelt:'yellow', beltDist:{white:7,yellow:11,orange:2}, journey:{done:13,total:60},  bench:{class:52,school:54,course:49}, hoursWk:4.8, sessionsWk:30, avgMins:15, activity:[3,4,4,4,5,3,4], joinCode:'KMP-EN2B', needs:'Picking up',                        health:'good' },
  { id:'5e-spa',  name:'5ème Español',     course:'Spanish · Level 1',     teacher:'Catell ar Gov', teacherId:'t-catell', students:16, classBelt:'yellow', beltDist:{white:5,yellow:9,orange:2},  journey:{done:14,total:60},  bench:{class:58,school:54,course:49}, hoursWk:5.2, sessionsWk:30, avgMins:17, activity:[4,4,5,4,5,3,5], joinCode:'KMP-ES1A', needs:'On track',                          health:'good' },
  { id:'3e-spa',  name:'3ème Español',     course:'Spanish · Level 2',     teacher:'Catell ar Gov', teacherId:'t-catell', students:16, classBelt:'orange', beltDist:{yellow:5,orange:9,green:2},  journey:{done:32,total:60},  bench:{class:70,school:54,course:49}, hoursWk:7.2, sessionsWk:38, avgMins:19, activity:[5,6,6,6,7,5,6], joinCode:'KMP-ES2B', needs:'Steady',                            health:'good' },
];

// Sample students per class (display set — real classes have full rosters)
window.SSI_STUDENTS = [
  // CM1 Brezhoneg
  { id:'s01', name:'Loïg Guéguen',   classId:'cm1',  belt:'yellow', legoDone:18, legoTotal:24, lastActive:'2h',  hours7d:1.2, streak:5,  health:'good' },
  { id:'s02', name:'Anjela Tanguy',  classId:'cm1',  belt:'orange', legoDone:22, legoTotal:24, lastActive:'1h',  hours7d:2.1, streak:12, health:'excellent' },
  { id:'s03', name:'Mael Le Floch',  classId:'cm1',  belt:'yellow', legoDone:15, legoTotal:24, lastActive:'4h',  hours7d:0.8, streak:3,  health:'good' },
  { id:'s04', name:'Soaz Riou',      classId:'cm1',  belt:'white',  legoDone:8,  legoTotal:24, lastActive:'1d',  hours7d:0.4, streak:1,  health:'needs-attention' },
  { id:'s05', name:'Yann Le Goff',   classId:'cm1',  belt:'yellow', legoDone:17, legoTotal:24, lastActive:'3h',  hours7d:1.5, streak:7,  health:'good' },
  { id:'s06', name:'Awen Cariou',    classId:'cm1',  belt:'yellow', legoDone:19, legoTotal:24, lastActive:'5h',  hours7d:1.8, streak:8,  health:'good' },
  { id:'s07', name:'Brieg Cornec',   classId:'cm1',  belt:'orange', legoDone:23, legoTotal:24, lastActive:'30m', hours7d:2.4, streak:14, health:'excellent' },
  { id:'s08', name:'Naïg Quéré',     classId:'cm1',  belt:'yellow', legoDone:16, legoTotal:24, lastActive:'2h',  hours7d:1.3, streak:6,  health:'good' },
  // 5ème Brezhoneg
  { id:'s11', name:'Erwann Floch',   classId:'5eme', belt:'orange', legoDone:34, legoTotal:48, lastActive:'1h',  hours7d:2.6, streak:9,  health:'excellent' },
  { id:'s12', name:'Tangi ar Bras',  classId:'5eme', belt:'green',  legoDone:42, legoTotal:48, lastActive:'45m', hours7d:3.1, streak:18, health:'excellent' },
  { id:'s13', name:'Maïwenn Le Bras',classId:'5eme', belt:'orange', legoDone:31, legoTotal:48, lastActive:'2h',  hours7d:2.2, streak:11, health:'good' },
  { id:'s14', name:'Yannig Coïc',    classId:'5eme', belt:'orange', legoDone:33, legoTotal:48, lastActive:'1h',  hours7d:2.8, streak:10, health:'excellent' },
  { id:'s15', name:'Klervi Ropars',  classId:'5eme', belt:'yellow', legoDone:24, legoTotal:48, lastActive:'5h',  hours7d:1.4, streak:4,  health:'good' },
  { id:'s16', name:'Gwendal Bihan',  classId:'5eme', belt:'orange', legoDone:30, legoTotal:48, lastActive:'3h',  hours7d:2.0, streak:7,  health:'good' },
  // 4ème Español
  { id:'s21', name:'Lucía Martín',   classId:'spa',  belt:'yellow', legoDone:9,  legoTotal:24, lastActive:'2h',  hours7d:1.1, streak:5,  health:'good' },
  { id:'s22', name:'Diego Ferrer',   classId:'spa',  belt:'white',  legoDone:4,  legoTotal:24, lastActive:'16d', hours7d:0.0, streak:0,  health:'needs-attention' },
  { id:'s23', name:'Iria Bouvier',   classId:'spa',  belt:'white',  legoDone:6,  legoTotal:24, lastActive:'1d',  hours7d:0.3, streak:1,  health:'good' },
  { id:'s24', name:'Alex Tristan',   classId:'spa',  belt:'yellow', legoDone:11, legoTotal:24, lastActive:'4h',  hours7d:1.6, streak:6,  health:'excellent' },
  { id:'s25', name:'Manon Cazals',   classId:'spa',  belt:'white',  legoDone:5,  legoTotal:24, lastActive:'19d', hours7d:0.0, streak:0,  health:'needs-attention' },
  { id:'s26', name:'Théo Ar Floc\'h',classId:'spa',  belt:'white',  legoDone:7,  legoTotal:24, lastActive:'2d',  hours7d:0.4, streak:2,  health:'good' },
];

window.SSI_TEACHERS = [
  { id:'t-erwan',  name:'Erwan Le Bihan',  initials:'EL', subject:'Brezhoneg',     classes:3, students:54, hours7d:20.4, role:'Teacher',     status:'active' },
  { id:'t-mona',   name:'Mona Riou',       initials:'MR', subject:'Brezhoneg',     classes:2, students:36, hours7d:14.8, role:'Teacher',     status:'active' },
  { id:'t-catell', name:'Catell ar Gov',   initials:'CG', subject:'Spanish + En',  classes:4, students:62, hours7d:22.1, role:'Teacher',     status:'active' },
  { id:'t-yannig', name:'Yannig Pelleau',  initials:'YP', subject:'Brezhoneg',     classes:1, students:18, hours7d:6.2,  role:'Admin',       status:'active' },
  { id:'t-soaz',   name:'Soazig Toudic',   initials:'ST', subject:'English',       classes:2, students:40, hours7d:11.4, role:'Teacher',     status:'active' },
  { id:'t-padrig', name:'Padrig Le Coz',   initials:'PC', subject:'Welsh North',   classes:2, students:38, hours7d:0.0,  role:'Teacher',     status:'invited' },
];

window.SSI_SCHOOLS_LIST = [
  { id:'sch-kmp', name:'Skol Diwan Kemper',      city:'Quimper',       students:312, teachers:18, classes:14, hoursWk:92.4, active7d:271, joined:'Sep 2024', health:'excellent' },
  { id:'sch-rzn', name:'Skol Diwan Roazhon',     city:'Rennes',        students:418, teachers:24, classes:19, hoursWk:118.6,active7d:366, joined:'Sep 2024', health:'excellent' },
  { id:'sch-bst', name:'Skol Diwan Brest',       city:'Brest',         students:286, teachers:16, classes:13, hoursWk:71.2, active7d:241, joined:'Sep 2024', health:'good' },
  { id:'sch-sbg', name:'Skol Diwan Sant-Brieg',  city:'Saint-Brieuc',  students:194, teachers:11, classes:9,  hoursWk:48.7, active7d:158, joined:'Jan 2025', health:'good' },
  { id:'sch-nzd', name:'Skol Diwan Naoned',      city:'Nantes',        students:340, teachers:20, classes:16, hoursWk:88.0, active7d:280, joined:'Sep 2024', health:'excellent' },
  { id:'sch-grg', name:'Skol Diwan Gwened',      city:'Vannes',        students:241, teachers:14, classes:11, hoursWk:54.2, active7d:188, joined:'Jan 2025', health:'good' },
  { id:'sch-mlx', name:'Skol Diwan Morlaez',     city:'Morlaix',       students:148, teachers:9,  classes:7,  hoursWk:31.6, active7d:104, joined:'Apr 2025', health:'needs-attention' },
  { id:'sch-lnn', name:'Skol Diwan Lannuon',     city:'Lannion',       students:122, teachers:8,  classes:6,  hoursWk:24.8, active7d:84,  joined:'Apr 2025', health:'good' },
  { id:'sch-pmp', name:'Skol Diwan Pempoull',    city:'Paimpol',       students:88,  teachers:6,  classes:4,  hoursWk:16.2, active7d:58,  joined:'Sep 2025', health:'good' },
  { id:'sch-kpr', name:'Skol Diwan Karaez',      city:'Carhaix',       students:104, teachers:7,  classes:5,  hoursWk:9.4,  active7d:42,  joined:'Sep 2025', health:'needs-attention' },
];

window.SSI_GOVT_TOTALS = {
  schools: 10,
  students: 2253,
  teachers: 133,
  classes: 104,
  hoursWk: 555,
  active7d: 1792,
};

window.SSI_COURSES = [
  { id:'welsh-north', name:'Welsh — North', flag:'🏴󠁧󠁢󠁷󠁬󠁳󠁿', levels:3, totalLegos:60 },
  { id:'spanish',     name:'Spanish',        flag:'🇪🇸', levels:3, totalLegos:60 },
  { id:'english',     name:'English',        flag:'🇬🇧', levels:3, totalLegos:60 },
  { id:'breton',      name:'Brezhoneg',      flag:'🇫🇷', levels:3, totalLegos:60 },
  { id:'cornish',     name:'Kernewek',       flag:'🏴󠁧󠁢󠁥󠁮󠁧󠁿', levels:2, totalLegos:40 },
  { id:'manx',        name:'Gaelg',          flag:'🇮🇲', levels:2, totalLegos:40 },
];
