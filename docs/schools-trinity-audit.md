# Schools Dashboard — Trinity Compliance Audit

> **Date**: 2026-04-11  
> **Scope**: All screens under `/schools`  
> **Trinity**: App→User (output) | User→App (input) | App→App (processing)

---

## Screen 1: Login (SchoolsContainer.vue)

### Email Step

| # | Direction | Message |
|---|-----------|---------|
| 1 | App→User | Display email input form with placeholder "you@school.edu" |
| 2 | App→User | Display "Continue" button (disabled until valid email) |
| 3 | App→User | Display error banner if `loginError` is set |
| 4 | User→App | Type email into input field |
| 5 | App→App | Validate email format via regex → enable/disable button |
| 6 | User→App | Submit form (click Continue or press Enter) |
| 7 | App→App | Call `supabase.auth.signInWithOtp({ email })` |
| 8 | App→User | Show loading state on button |
| 9 | App→User | On success: transition to OTP step |
| 10 | App→User | On failure: show error message in banner |

### OTP Step

| # | Direction | Message |
|---|-----------|---------|
| 11 | App→User | Display OTP input (6-digit, monospace, centered) |
| 12 | App→User | Display "Verify" button (disabled until 6 digits) |
| 13 | App→User | Display "Back" button to return to email step |
| 14 | User→App | Type 6-digit OTP code |
| 15 | App→App | Validate length >= 6 → enable/disable Verify button |
| 16 | User→App | Submit OTP (click Verify or press Enter) |
| 17 | App→App | Call `supabase.auth.verifyOtp({ email, token })` |
| 18 | App→User | On success: transition to dashboard (or No Access screen) |
| 19 | App→User | On failure: show error message |
| 20 | User→App | Click "Back" button |
| 21 | App→App | Reset to email step, clear OTP and errors |

### No Access Screen (authenticated but no school role)

| # | Direction | Message |
|---|-----------|---------|
| 22 | App→User | Display "No access" message with join code input |
| 23 | User→App | Type join code into input |
| 24 | User→App | Submit join code form |
| 25 | App→App | Call validate + redeem API endpoints |
| 26 | App→User | On success: "Code redeemed! Loading..." message |
| 27 | App→App | Reload page after 500ms |
| 28 | App→User | On failure: show `joinCodeError` message |

---

## Screen 2: Dashboard (DashboardView.vue)

### Teacher View

| # | Direction | Message |
|---|-----------|---------|
| 29 | App→User | Display "My Classes" title |
| 30 | App→User | Display loading spinner while `isTeacherLoading` |
| 31 | App→User | Display class list (name, language, student count, play button) |
| 32 | App→User | Display empty state "No classes yet" if no classes |
| 33 | User→App | Click play button on a class row |
| 34 | App→App | Store class to `localStorage['ssi-active-class']` |
| 35 | App→App | `router.push('/', { query: { class: cls.id } })` → navigate to player |
| 36 | User→App | Click "Manage classes" link |
| 37 | App→App | Navigate to `/schools/classes` |

### Admin View

| # | Direction | Message |
|---|-----------|---------|
| 38 | App→User | Display "Dashboard" title |
| 39 | App→User | Display loading spinner while `isLoading` |
| 40 | App→User | Display 4 stats cards (Students, Hours, Classes, Teachers) |
| 41 | User→App | Click "Students" card |
| 42 | App→App | Navigate to `/schools/students` |
| 43 | User→App | Click "Hours Practiced" card |
| 44 | App→App | Navigate to `/schools/analytics` |
| 45 | User→App | Click "Classes" card |
| 46 | App→App | Navigate to `/schools/classes` |
| 47 | User→App | Click "Teachers" card |
| 48 | App→App | Navigate to `/schools/teachers` |
| 49 | App→User | Display Course Access card (courses school is entitled to) |
| 50 | App→User | Display loading spinner on Course Access card while fetching |

### Admin Quick Actions

| # | Direction | Message |
|---|-----------|---------|
| 51 | User→App | Click "Start Session" |
| 52 | App→App | Navigate to `/schools/classes` |
| 53 | User→App | Click "Add Student" |
| 54 | App→App | Navigate to `/schools/students` |
| 55 | User→App | Click "Add Teacher" |
| 56 | App→App | Navigate to `/schools/teachers` |
| 57 | User→App | Click "View Reports" |
| 58 | App→App | Navigate to `/schools/analytics` |

### Government Admin View

| # | Direction | Message |
|---|-----------|---------|
| 59 | App→User | Display schools grid (card per school: name, avatar, stats) |
| 60 | App→User | Display group title "Schools in [group] (X schools)" |
| 61 | App→User | Display contribution counter (phrases, minutes, speakers today) |
| 62 | App→User | Display group cycles summary (school rows with speaking opportunities) |
| 63 | User→App | Click a school card |
| 64 | App→App | `selectSchoolToView(school)` → set drill-down context |
| 65 | App→App | All child composables re-query filtered by that school |
| 66 | App→User | Show breadcrumb with group → school path |
| 67 | User→App | Click back arrow / group name in breadcrumb |
| 68 | App→App | `clearViewingSchool()` → return to group view |
| 69 | App→App | All child composables re-query at group level |

---

## Screen 3: Schools List (SchoolsView.vue) — Govt Admin Only

| # | Direction | Message |
|---|-----------|---------|
| 70 | App→User | Display search box ("Search schools...") |
| 71 | App→User | Display school cards grid with staggered animation |
| 72 | User→App | Type in search box |
| 73 | App→App | Filter `schools` array by name match |
| 74 | App→User | Update visible cards in real-time |
| 75 | App→User | Show "No schools found" if no results and no query |
| 76 | App→User | Show "No results for 'X'" if no results with query |
| 77 | User→App | Click a school card |
| 78 | App→App | `selectSchoolToView(school)` + `router.push('/schools')` |

---

## Screen 4: Students (StudentsView.vue)

| # | Direction | Message |
|---|-----------|---------|
| 79 | App→User | Display header with "Export" and "Add Student" buttons |
| 80 | App→User | Display search box + class filter dropdown + belt filter dropdown |
| 81 | App→User | Display students table (name, class, belt, progress bar, phrases, sessions, last active) |
| 82 | App→User | Display "No students found" empty state |
| 83 | User→App | Type in search box |
| 84 | App→App | Filter students by name/email |
| 85 | User→App | Select class from dropdown |
| 86 | App→App | Filter students by class_id |
| 87 | User→App | Select belt from dropdown |
| 88 | App→App | Filter students by belt level |
| 89 | User→App | Click row action button (three dots) |
| 90 | App→App | Set `selectedStudent` → open detail panel |
| 91 | App→User | Slide in student detail panel (name, stats, class, belt) |
| 92 | User→App | Click close (X) on detail panel |
| 93 | App→App | Set `selectedStudent = null` |
| 94 | App→User | Slide out detail panel |
| 95 | User→App | Click "Export" button |
| 96 | App→App | `handleExport()` — not yet implemented |
| 97 | User→App | Click "Add Student" button |
| 98 | App→App | `handleAddStudent()` — students self-enroll via codes |

---

## Screen 5: Teachers (TeachersView.vue)

| # | Direction | Message |
|---|-----------|---------|
| 99 | App→User | Display header with "Add Teacher" button |
| 100 | App→User | Display admin join code (if available) with copy button |
| 101 | App→User | Display search box + course filter + belt filter |
| 102 | App→User | Display teacher cards/rows (name, classes, students, hours) |
| 103 | App→User | Display "No teachers found" empty state |
| 104 | App→User | Display "Try adjusting your search or filters" if filtered empty |
| 105 | User→App | Type in search box |
| 106 | App→App | Filter teachers by name |
| 107 | User→App | Select course filter |
| 108 | App→App | Filter teachers by course |
| 109 | User→App | Select belt filter |
| 110 | App→App | Filter teachers by belt |
| 111 | User→App | Click teacher row |
| 112 | App→App | Set `selectedTeacher` → open detail panel |
| 113 | App→User | Display teacher detail panel (name, belt, practice hours) |
| 114 | User→App | Click close on detail panel |
| 115 | App→App | Set `selectedTeacher = null` |
| 116 | User→App | Click "Add Teacher" button |
| 117 | App→App | Set `showAddModal = true` |
| 118 | App→User | Display Add Teacher modal |
| 119 | User→App | Fill form inputs (name, email) |
| 120 | User→App | Click "Cancel" or close (X) |
| 121 | App→App | Set `showAddModal = false`, clear form |
| 122 | User→App | Submit add teacher form |
| 123 | App→App | API call to create teacher record |
| 124 | App→User | Show loading spinner on submit button |
| 125 | App→User | On success: close modal, refresh teacher list |
| 126 | App→User | On failure: show error in modal |
| 127 | User→App | Click edit button on a teacher |
| 128 | App→App | Open edit flow |
| 129 | User→App | Click remove button on a teacher |
| 130 | App→App | `handleRemoveTeacher(teacher.user_id)` → API call to remove |

---

## Screen 6: Classes / Teacher Dashboard (TeacherDashboard.vue)

| # | Direction | Message |
|---|-----------|---------|
| 131 | App→User | Display class cards (ClassCard component per class) |
| 132 | App→User | Each card shows: class name, language flag, belt, journey progress, benchmarks, stats, join code |
| 133 | User→App | Click "Play" button on a class card |
| 134 | App→App | Emit `play` → store class to localStorage → navigate to `/` with class query |
| 135 | User→App | Click "View Roster" on a class card |
| 136 | App→App | Navigate to `/schools/classes/:id` |
| 137 | User→App | Click copy join code on a class card |
| 138 | App→App | Copy to clipboard |
| 139 | App→User | Show green checkmark "Copied!" for 2s |
| 140 | User→App | Click "Create Class" button |
| 141 | App→App | Open CreateClassModal |
| 142 | App→User | Display CreateClassModal (name input, course dropdown) |
| 143 | User→App | Fill class name and select course |
| 144 | User→App | Submit create class form |
| 145 | App→App | INSERT into `classes` table + INSERT invite code |
| 146 | App→User | On success: show ClassCreatedModal with join code |
| 147 | App→User | On failure: show error in modal |
| 148 | User→App | Click "Go to Class" in ClassCreatedModal |
| 149 | App→App | Navigate to `/schools/classes/:id` |
| 150 | User→App | Copy join code from ClassCreatedModal |
| 151 | App→App | Copy to clipboard |
| 152 | App→User | Show checkmark confirmation |

---

## Screen 7: Class Detail (ClassDetail.vue)

| # | Direction | Message |
|---|-----------|---------|
| 153 | App→User | Display back button |
| 154 | App→User | Display class name, course info |
| 155 | App→User | Display "Play as Class" button (large, primary) |
| 156 | App→User | Display class report card (school/group/course avg comparisons) |
| 157 | App→User | Display join code with copy button |
| 158 | App→User | Display student roster search box |
| 159 | App→User | Display student roster table |
| 160 | App→User | Display session history (if sessions exist) |
| 161 | User→App | Click back button |
| 162 | App→App | `router.push({ name: 'classes' })` |
| 163 | User→App | Click "Play as Class" button |
| 164 | App→App | Store class to localStorage → `router.push('/', { query: { class: id } })` |
| 165 | User→App | Click copy join code button |
| 166 | App→App | Copy to clipboard |
| 167 | App→User | Show checkmark icon + "Copied!" temporarily |
| 168 | User→App | Type in student search box |
| 169 | App→App | Filter `filteredStudents` computed by name |
| 170 | App→User | Update visible roster rows |
| 171 | App→User | Show "No students match..." if filtered empty |
| 172 | User→App | Click remove student button |
| 173 | App→App | API call to remove student from class → refresh roster |

---

## Screen 8: Analytics (AnalyticsView.vue)

| # | Direction | Message |
|---|-----------|---------|
| 174 | App→User | Display period selector buttons (7d / 30d / all) |
| 175 | App→User | Display volume cards (speaking opportunities, minutes, sections covered) |
| 176 | App→User | Display per-class breakdown table (belt badge, progress bar, stats) |
| 177 | App→User | Display loading spinner while `isLoading` |
| 178 | App→User | Display "No classes found" empty state |
| 179 | User→App | Click period button (7d / 30d / all) |
| 180 | App→App | Update `selectedPeriod` → trigger `fetchClassSessions()` |
| 181 | App→User | Highlight active period button (red background) |
| 182 | App→User | Update volume cards and class breakdown with new data |

---

## Screen 9: Student Progress (StudentProgressView.vue)

| # | Direction | Message |
|---|-----------|---------|
| 183 | App→User | Display "My Progress" title |
| 184 | App→User | Display overall progress card (belt badge XL, progress bar, stats) |
| 185 | App→User | Display "X seeds to Y Belt" progress label |
| 186 | App→User | Display stats row (Seeds, LEGOs, Time, Courses) |
| 187 | App→User | Display course cards grid (per course: name, belt, stats, last practiced) |
| 188 | App→User | Display "No courses yet" + "ask teacher for join code" if empty |

> **Note**: This is a display-only screen — no user interactions beyond navigation.

---

## Screen 10: Settings (SettingsView.vue)

### School Profile

| # | Direction | Message |
|---|-----------|---------|
| 189 | App→User | Display school name input (pre-populated) |
| 190 | App→User | Display contact email input (pre-populated) |
| 191 | App→User | Display "Save Changes" button |
| 192 | User→App | Edit school name |
| 193 | User→App | Edit contact email |
| 194 | User→App | Click "Save Changes" |
| 195 | App→App | Call `saveSchoolProfile()` API |
| 196 | App→User | Button shows "Saving..." during request |
| 197 | App→User | Button shows "Saved!" on success |

### Localization

| # | Direction | Message |
|---|-----------|---------|
| 198 | App→User | Display timezone dropdown (London, Dublin, NY, LA) |
| 199 | App→User | Display dashboard language dropdown (English, Welsh, Spanish) |
| 200 | User→App | Select timezone |
| 201 | User→App | Select language |
| 202 | User→App | Click "Save Changes" |
| 203 | App→App | Save to localStorage |
| 204 | App→User | Show save confirmation |

### Data & Privacy

| # | Direction | Message |
|---|-----------|---------|
| 205 | App→User | Display "Export" button |
| 206 | App→User | Display "Delete" button (danger) |
| 207 | User→App | Click Export |
| 208 | App→App | Placeholder — not yet implemented |
| 209 | User→App | Click Delete |
| 210 | App→App | Placeholder — not yet implemented |

---

## Screen 11: Admin Setup (SetupView.vue)

### Banners

| # | Direction | Message |
|---|-----------|---------|
| 211 | App→User | Display success banner (animated) when `successMessage` set |
| 212 | App→User | Display error banner (animated) when `error` set |

### Create School

| # | Direction | Message |
|---|-----------|---------|
| 213 | App→User | Display school name input |
| 214 | App→User | Display group dropdown |
| 215 | App→User | Display "Create School" button (disabled while loading) |
| 216 | User→App | Type school name |
| 217 | User→App | Select group |
| 218 | User→App | Click "Create School" |
| 219 | App→App | Call `createSchool()` API |
| 220 | App→User | Show spinner on button while loading |
| 221 | App→User | On success: show success banner, refresh schools list |
| 222 | App→User | On failure: show error banner |

### Schools Management

| # | Direction | Message |
|---|-----------|---------|
| 223 | App→User | Display schools list with group assignment dropdowns |
| 224 | App→User | Display entitlement badges (source: group/direct) |
| 225 | App→User | Display teacher join code + copy button per school |
| 226 | App→User | Display admin join code + copy button per school |
| 227 | User→App | Change school group dropdown |
| 228 | App→App | `updateSchoolGroup()` API call |
| 229 | User→App | Click copy teacher code |
| 230 | App→App | Copy to clipboard |
| 231 | App→User | Show checkmark feedback temporarily |
| 232 | User→App | Click copy admin code |
| 233 | App→App | Copy to clipboard |
| 234 | App→User | Show checkmark feedback temporarily |
| 235 | User→App | Click edit entitlements button |
| 236 | App→App | Open course assignment context |
| 237 | User→App | Click delete school button |
| 238 | App→App | `deleteSchool()` API call |

### Create Staff

| # | Direction | Message |
|---|-----------|---------|
| 239 | App→User | Display staff form (name, email, school dropdown, role dropdown) |
| 240 | User→App | Fill name input |
| 241 | User→App | Fill email input |
| 242 | User→App | Select school |
| 243 | User→App | Select role (teacher/admin) |
| 244 | User→App | Click "Create Staff" |
| 245 | App→App | Call `createStaff()` API |
| 246 | App→User | Show spinner while loading |
| 247 | App→User | On success: show success banner |
| 248 | App→User | On failure: show error banner |

### Groups Management

| # | Direction | Message |
|---|-----------|---------|
| 249 | App→User | Display group tree (hierarchy with courses granted) |
| 250 | App→User | Display create group form (name, type, parent) |
| 251 | User→App | Type group name |
| 252 | User→App | Select group type (group/region) |
| 253 | User→App | Select parent group |
| 254 | User→App | Click "Create Group" |
| 255 | App→App | Call `createGroup()` API |
| 256 | App→User | Show spinner while loading |
| 257 | User→App | Click group name in tree to rename |
| 258 | App→App | Set `editingGroupId` → name becomes editable |
| 259 | App→User | Show inline text input at group position |
| 260 | User→App | Edit group name in inline input |
| 261 | User→App | Click delete group button |
| 262 | App→App | Call `deleteGroup()` API |

### Course Grants

| # | Direction | Message |
|---|-----------|---------|
| 263 | App→User | Display grant target type selector (group/school) |
| 264 | App→User | Display grant target ID dropdown |
| 265 | App→User | Display inherited notice if school inherits from group |
| 266 | App→User | Display course list with checkboxes |
| 267 | App→User | Display "Select All" and "Clear" buttons |
| 268 | App→User | Display course search filter |
| 269 | User→App | Select target type (group/school) |
| 270 | User→App | Select target ID from dropdown |
| 271 | App→App | Check inheritance → show inherited notice if applicable |
| 272 | User→App | Click "Select All" |
| 273 | App→App | Add all courses to `grantCourses` array |
| 274 | User→App | Click "Clear" |
| 275 | App→App | Clear `grantCourses` array |
| 276 | User→App | Type in course search |
| 277 | App→App | Filter visible courses by name |
| 278 | User→App | Click course checkbox |
| 279 | App→App | Toggle course in `grantCourses` array |
| 280 | User→App | Click "Save Grant" |
| 281 | App→App | Call `saveGrant()` API → update entitlements |
| 282 | App→User | Show spinner while loading |
| 283 | App→User | On success: refresh entitlement display |

---

## Global: Top Navigation (TopNav.vue)

| # | Direction | Message |
|---|-----------|---------|
| 284 | App→User | Display logo (navigates to /schools on click) |
| 285 | App→User | Display nav tabs (Dashboard, Teachers, Students, Classes, Analytics) |
| 286 | App→User | Display active tab with red highlight |
| 287 | App→User | Display user menu button (avatar) |
| 288 | App→User | Display "Sign In" / "Get Started" if unauthenticated |
| 289 | App→User | Display school badge (school name) |
| 290 | App→User | Display admin tab (/schools/setup) if admin |
| 291 | App→User | Display "All Schools" tab if govt_admin |
| 292 | User→App | Click logo |
| 293 | App→App | Navigate to `/schools` |
| 294 | User→App | Click nav tab |
| 295 | App→App | Navigate to tab's route |
| 296 | User→App | Click user menu button |
| 297 | App→User | Show dropdown menu (slide-up animation) |
| 298 | User→App | Click "Sign Out" in menu |
| 299 | App→App | Call `supabase.auth.signOut()` |
| 300 | User→App | Click "Learn" button |
| 301 | App→App | Navigate to `/` (player) |
| 302 | User→App | Click "Admin" button (if SSi admin) |
| 303 | App→App | Navigate to `/admin` |

---

## Global: God Mode Panel (GodModePanel.vue)

| # | Direction | Message |
|---|-----------|---------|
| 304 | App→User | Display toggle button (bottom-right, eye icon + "GOD") |
| 305 | User→App | Click toggle button |
| 306 | App→User | Open side panel (320px wide, gradient border) |
| 307 | App→User | Display current user section (avatar, name, role, school) |
| 308 | App→User | Display role filter buttons with counts |
| 309 | App→User | Display user search box |
| 310 | App→User | Display user list (max 50, scrollable) |
| 311 | App→User | Show "Loading users..." while fetching |
| 312 | User→App | Type in user search |
| 313 | App→App | Filter users by name (case-insensitive) |
| 314 | User→App | Click role filter button |
| 315 | App→App | Toggle role filter (additive/removable) |
| 316 | User→App | Click a user in the list |
| 317 | App→App | Call `godMode.selectUser(user)` → store in localStorage |
| 318 | App→App | Call `router.go(0)` → full page reload as that user |
| 319 | User→App | Click "Clear" to stop impersonation |
| 320 | App→App | Clear localStorage → reload as self |

---

## Compliance Issues Found & Fixed (2026-04-11)

### Fixed: Dead buttons

| # | Screen | Fix |
|---|--------|-----|
| 1 | Students | "Export" — now exports filtered student list as CSV |
| 2 | Students | "Add Student" — now shows info banner explaining join code self-enrollment |
| 3 | Settings | "Export" — now exports school's `class_student_progress` data as CSV |
| 4 | Settings | "Delete" — now wired with double-confirmation before deleting progress data |

### Fixed: Missing error feedback

| # | Screen | Fix |
|---|--------|-----|
| 5 | Classes (createClass) | Error toast now displayed when `createClass()` fails (red banner, click to dismiss) |

### Already compliant (native confirm() dialogs)

| # | Screen | Status |
|---|--------|--------|
| 6 | Teachers | Remove teacher — uses `confirm()` |
| 7 | Class Detail | Remove student — uses `confirm()` |
| 8 | Setup | Delete school — uses `confirm()` |
| 9 | Setup | Delete group — uses `confirm()` |

### Architectural Notes

| # | Pattern | Status |
|---|---------|--------|
| 10 | All composable errors stored in `error` ref | Views must check — some may not display |
| 11 | All composables follow `isLoading` / `error` / data pattern | Consistent |
| 12 | Demo mode skips all Supabase queries | All composables support |
| 13 | Drill-down context propagation via `viewingSchool` | Works automatically |
| 14 | Session management (start/end) | Fully wired: INSERT + UPDATE `class_sessions` |

---

## Summary

| Metric | Count |
|--------|-------|
| Total screens | 11 (+ 2 global components) |
| App→User messages | ~120 |
| User→App messages | ~100 |
| App→App messages | ~100 |
| **Total trinity messages** | **~320** |
| Issues found | 9 |
| Issues fixed | 5 (dead buttons + error feedback) |
| Already compliant | 4 (native confirm dialogs) |
