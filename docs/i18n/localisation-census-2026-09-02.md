# Every English string in the app — localisation census

Generated 2026-09-02 from `origin/dev` @ 64cfb8cf, branch `feat/i18n-full-localisation-2026-09-02`.

## What the numbers mean

A *hit* is one hardcoded, user-visible English string in a component **template**: a text node, or a static `placeholder` / `title` / `aria-label` / `alt` / `label` attribute. Strings already going through `t()` are not counted. Script-side literals (toasts, error messages, computed labels) are counted separately and are not in these totals.

Locale parity on `origin/dev` before this work: **all 22 locale files carry all 387 keys — zero missing.** The gap is not the locale files; it is that only 16 of 191 components ever call `t()`.

## By screen area

| Screen area | Files | Hardcoded strings |
|---|---:|---:|
| Admin | 52 | 627 |
| Schools | 23 | 534 |
| Player & core screens | 28 | 428 |
| Insight (admin) | 23 | 211 |
| Gateway / redeem / install | 6 | 139 |
| Teach | 3 | 132 |
| Profile / How this works | 16 | 92 |
| Methodology | 3 | 85 |
| Onboarding | 1 | 66 |
| Auth | 3 | 34 |
| **Total** | **158** | **2348** |

## By priority tier

Tier ordering below is the dispatching brief's default, **not a ruling of Tom's** — he can overrule it.

| Tier | Audience | Files | Strings |
|---|---|---:|---:|
| 1 | Learner-facing (mandatory) | 50 | 685 |
| 2 | Teacher / school-facing | 33 | 821 |
| 3 | Internal admin (English-reading) | 75 | 842 |

## Beyond the templates

- **`src/explainer/learnerExplainers.ts`** — 38 prose fields of learner-facing copy for the "How this works" explainer. Long-form paragraphs, not button labels; localising it is a materially different translation job from UI chrome.
- **Script-side literals in tier-1 files** — ~28 user-visible strings assigned to `error`/`status`/`message` refs or passed to `alert()`/`confirm()`.
- **`api/_utils/inviteEmailTemplate.ts`** — a server-rendered English email. Localising it needs a **locale parameter on the API route**, i.e. a mechanism, not a translation. Flagged, not built.
- **Never translated:** the brand **SaySomethingin** — one word, lower-case i, verbatim English in every language.

## Per-file inventory

### Tier 1 — Learner-facing (mandatory)

| File | Area | Strings |
|---|---|---:|
| `components/SettingsScreen.vue` | Player & core screens | 106 |
| `components/LearningPlayer.vue` | Player & core screens | 79 |
| `views/onboarding/Onboarding.vue` | Onboarding | 66 |
| `views/InstallGuide.vue` | Gateway / redeem / install | 61 |
| `views/RedeemCode.vue` | Gateway / redeem / install | 54 |
| `components/BrowseScreen.vue` | Player & core screens | 29 |
| `components/CourseExplorer.vue` | Player & core screens | 29 |
| `components/auth/SignInModal.vue` | Auth | 26 |
| `components/FamilyManagementModal.vue` | Player & core screens | 18 |
| `components/CourseSelector.vue` | Player & core screens | 14 |
| `components/ListeningOverlay.vue` | Player & core screens | 13 |
| `components/ProgressModal.vue` | Player & core screens | 11 |
| `components/TesterFeedback.vue` | Player & core screens | 10 |
| `components/me/SettingsDirection.vue` | Profile / How this works | 9 |
| `views/JoinWithCode.vue` | Gateway / redeem / install | 9 |
| `components/PronunciationOverlay.vue` | Player & core screens | 8 |
| `components/me/PlanPanel.vue` | Profile / How this works | 8 |
| `components/me/StandingPanel.vue` | Profile / How this works | 8 |
| `components/me/HowThisWorksLibrary.vue` | Profile / How this works | 7 |
| `components/me/MirrorPanel.vue` | Profile / How this works | 7 |
| `components/learner/SessionMirror.vue` | Player & core screens | 6 |
| `components/me/ClimbingBandFigure.vue` | Profile / How this works | 6 |
| `components/me/CyclePillFigure.vue` | Profile / How this works | 6 |
| `components/me/PortraitPanel.vue` | Profile / How this works | 6 |
| `components/me/WornPathFigure.vue` | Profile / How this works | 6 |
| `components/PwaUpdatePrompt.vue` | Player & core screens | 5 |
| `components/me/AdherencePanel.vue` | Profile / How this works | 5 |
| `components/me/ThreeGapsFigure.vue` | Profile / How this works | 5 |
| `views/TryLinkGateway.vue` | Gateway / redeem / install | 5 |
| `views/marketing/PartnerDoor.vue` | Gateway / redeem / install | 5 |
| `components/AuthPrompt.vue` | Auth | 4 |
| `components/InstallBanner.vue` | Player & core screens | 4 |
| `components/SessionComplete.vue` | Player & core screens | 4 |
| `components/auth/AuthModal.vue` | Auth | 4 |
| `components/me/ListeningStretchFigure.vue` | Profile / How this works | 4 |
| `components/me/PlayerScreenFigure.vue` | Profile / How this works | 4 |
| `components/me/SpacingReturnsFigure.vue` | Profile / How this works | 4 |
| `views/me/ProfileView.vue` | Profile / How this works | 4 |
| `App.vue` | Player & core screens | 3 |
| `components/BottomNav.vue` | Player & core screens | 3 |
| `components/CourseBrowser.vue` | Player & core screens | 3 |
| `components/InAppBrowser.vue` | Player & core screens | 3 |
| `components/ProsodyFeedback.vue` | Player & core screens | 3 |
| `components/me/CourseSwitchRow.vue` | Profile / How this works | 3 |
| `components/ModeTray.vue` | Player & core screens | 2 |
| `components/shared/RefreshButton.vue` | Player & core screens | 2 |
| `components/CheckoutOverlay.vue` | Player & core screens | 1 |
| `components/ListeningModeToggle.vue` | Player & core screens | 1 |
| `components/ReportIssueButton.vue` | Player & core screens | 1 |
| `components/shared/UpdatedStamp.vue` | Player & core screens | 1 |

### Tier 2 — Teacher / school-facing

| File | Area | Strings |
|---|---|---:|
| `views/schools/DashboardView.vue` | Schools | 89 |
| `views/teach/TeachDashboard.vue` | Teach | 73 |
| `views/schools/ClassDetail.vue` | Schools | 63 |
| `containers/SchoolsContainer.vue` | Player & core screens | 57 |
| `views/methodology/EmpiricalBaselineView.vue` | Methodology | 54 |
| `views/schools/SetupView.vue` | Schools | 45 |
| `views/schools/TeacherDashboard.vue` | Schools | 43 |
| `views/teach/WithTeacher.vue` | Teach | 43 |
| `views/schools/TeachersView.vue` | Schools | 41 |
| `views/schools/SchoolsView.vue` | Schools | 40 |
| `views/schools/SettingsView.vue` | Schools | 39 |
| `views/schools/StudentsView.vue` | Schools | 38 |
| `views/schools/UpgradeView.vue` | Schools | 37 |
| `views/methodology/MethodologyView.vue` | Methodology | 26 |
| `views/schools/StudentProgressView.vue` | Schools | 19 |
| `containers/TeachContainer.vue` | Teach | 16 |
| `components/schools/NodeEntitlementControl.vue` | Schools | 15 |
| `components/schools/shared/TopNav.vue` | Schools | 12 |
| `components/schools/CreateClassModal.vue` | Schools | 11 |
| `components/schools/shared/SchoolsTopBar.vue` | Schools | 10 |
| `components/schools/AssignClassesModal.vue` | Schools | 9 |
| `containers/AdminContainer.vue` | Admin | 9 |
| `components/schools/SchoolsPasswordPrompt.vue` | Schools | 6 |
| `components/schools/ClassCreatedModal.vue` | Schools | 5 |
| `containers/MethodologyContainer.vue` | Methodology | 5 |
| `components/schools/ConfirmDeleteModal.vue` | Schools | 4 |
| `components/schools/shared/SchoolsErrorBoundary.vue` | Schools | 3 |
| `components/schools/shared/PlayAsClassIdentity.vue` | Schools | 2 |
| `containers/AdminGroupContainer.vue` | Admin | 2 |
| `containers/AdminSchoolsContainer.vue` | Admin | 2 |
| `components/schools/shared/BeltStrip.vue` | Schools | 1 |
| `components/schools/shared/FilterDropdown.vue` | Schools | 1 |
| `components/schools/shared/SearchBox.vue` | Schools | 1 |

### Tier 3 — Internal admin (English-reading)

| File | Area | Strings |
|---|---|---:|
| `views/admin/AdminUserDetail.vue` | Admin | 111 |
| `insight/VadPanel.vue` | Insight (admin) | 48 |
| `views/admin/AdminStructure.vue` | Admin | 43 |
| `components/admin/invites/EmailAllowlistForm.vue` | Admin | 42 |
| `views/admin/NodeHomeView.vue` | Admin | 42 |
| `views/admin/AdminUsers.vue` | Admin | 29 |
| `components/admin/NodeActionBar.vue` | Admin | 27 |
| `components/admin/invites/IndividualAccessForm.vue` | Admin | 27 |
| `insight/boards/CoverageBoard.vue` | Insight (admin) | 20 |
| `insight/boards/DifficultyTurnsBoard.vue` | Insight (admin) | 19 |
| `views/admin/AdminReleaseNotes.vue` | Admin | 18 |
| `views/admin/BoardReportView.vue` | Admin | 18 |
| `components/admin/WaysInLedger.vue` | Admin | 16 |
| `views/admin/AdminCourses.vue` | Admin | 16 |
| `components/admin/invites/DemoOrgsPanel.vue` | Admin | 15 |
| `components/admin/invites/UnifiedInviteList.vue` | Admin | 15 |
| `insight/TeacherInsightsView.vue` | Insight (admin) | 15 |
| `insight/NodeRateEngine.vue` | Insight (admin) | 14 |
| `insight/boards/RatesBoard.vue` | Insight (admin) | 14 |
| `views/admin/AdminActivity.vue` | Admin | 14 |
| `views/admin/analytics/FrictionTab.vue` | Admin | 14 |
| `components/admin/invites/OrgInviteForm.vue` | Admin | 13 |
| `views/admin/analytics/RetentionTab.vue` | Admin | 13 |
| `components/admin/GroupTreeNode.vue` | Admin | 12 |
| `insight/boards/ContentFrictionBoard.vue` | Insight (admin) | 11 |
| `insight/InsightsView.vue` | Insight (admin) | 10 |
| `views/admin/analytics/EngagementTab.vue` | Admin | 10 |
| `insight/DiscoveryFeed.vue` | Insight (admin) | 9 |
| `insight/boards/HealthStrip.vue` | Insight (admin) | 9 |
| `insight/boards/LifecycleBoard.vue` | Insight (admin) | 9 |
| `components/PodStageAuditioner.vue` | Player & core screens | 8 |
| `components/admin/StructureTreeNode.vue` | Admin | 8 |
| `components/admin/invites/DemoOrgCreateForm.vue` | Admin | 8 |
| `insight/boards/VadBoard.vue` | Insight (admin) | 8 |
| `views/admin/AdminAttention.vue` | Admin | 8 |
| `views/admin/NodeInsightsView.vue` | Admin | 8 |
| `views/admin/analytics/GrowthTab.vue` | Admin | 8 |
| `views/admin/analytics/OverviewTab.vue` | Admin | 7 |
| `insight/boards/CourseScoreboard.vue` | Insight (admin) | 6 |
| `insight/components/RateCompare.vue` | Insight (admin) | 6 |
| `views/admin/AdminMethodology.vue` | Admin | 6 |
| `views/admin/AdminStatsView.vue` | Admin | 6 |
| `components/admin/AdminTopBar.vue` | Admin | 5 |
| `components/admin/ManagerOnboardingGate.vue` | Admin | 5 |
| `components/admin/NodeChildrenList.vue` | Admin | 5 |
| `components/admin/NodeMapRail.vue` | Admin | 5 |
| `components/admin/YourAccount.vue` | Admin | 5 |
| `components/admin/invites/PreviewLinkForm.vue` | Admin | 5 |
| `insight/InsightWidget.vue` | Insight (admin) | 5 |
| `views/BoardSnapshotView.vue` | Gateway / redeem / install | 5 |
| `components/admin/invites/InviteCreateCard.vue` | Admin | 4 |
| `missions/MissionCard.vue` | Player & core screens | 4 |
| `views/admin/AdminInvites.vue` | Admin | 4 |
| `components/admin/invites/CoursePicker.vue` | Admin | 3 |
| `components/admin/invites/DirectAccessForm.vue` | Admin | 3 |
| `views/admin/AdminAnalytics.vue` | Admin | 3 |
| `components/admin/HowThisWorks.vue` | Admin | 2 |
| `components/admin/WalkCard.vue` | Admin | 2 |
| `components/admin/BoardInlineSegments.vue` | Admin | 1 |
| `components/admin/NodeMapRailSkeleton.vue` | Admin | 1 |
| `components/admin/NoticingInvitations.vue` | Admin | 1 |
| `components/admin/WalkOffer.vue` | Admin | 1 |
| `components/admin/charts/BarChart.vue` | Admin | 1 |
| `components/admin/charts/Histogram.vue` | Admin | 1 |
| `components/admin/charts/HorizontalBarChart.vue` | Admin | 1 |
| `components/admin/charts/LineChart.vue` | Admin | 1 |
| `insight/components/RateTrend.vue` | Insight (admin) | 1 |
| `insight/widgets/Distribution.vue` | Insight (admin) | 1 |
| `insight/widgets/Flow.vue` | Insight (admin) | 1 |
| `insight/widgets/Map.vue` | Insight (admin) | 1 |
| `insight/widgets/RankedBar.vue` | Insight (admin) | 1 |
| `insight/widgets/Table.vue` | Insight (admin) | 1 |
| `insight/widgets/TimeSeries.vue` | Insight (admin) | 1 |
| `insight/widgets/Treemap.vue` | Insight (admin) | 1 |
| `views/admin/AdminClassInsights.vue` | Admin | 1 |
