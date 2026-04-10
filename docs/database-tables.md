# Database Tables Reference

> Auto-generated from codebase audit 2026-04-10. Keep this in sync with actual migrations.

## Content & Audio

| Table | PK | Purpose |
|-------|-----|---------|
| `courses` | course_code | Course metadata, voice config (known_voice, target_voice_1, target_voice_2, presentation_voice) |
| `course_seeds` | id | Full sentences per course |
| `course_legos` | id | Learning units with denormalized audio IDs (known_audio_id, target1_audio_id, target2_audio_id) |
| `course_practice_phrases` | id | Practice sentences with denormalized audio IDs |
| `course_audio` | id (UUID text) | Audio file references — s3_key, duration_ms, course_code, text, role, voice_id |
| `audio_plays` | id | Analytics: tracks every audio request |

**IMPORTANT:** The audio table is `course_audio`, NOT `audio_samples`. The `audio_samples` table does not exist.

## Learner & User Management

| Table | PK | Purpose |
|-------|-----|---------|
| `learners` | id | User profiles — display_name, educational_role, platform_role, verified_emails, preferences |
| `user_entitlements` | id | Entitlements granted to learners |
| `user_tags` | id | Role assignments — links users to schools/classes with role_in_context |
| `course_enrollments` | id | User enrollment in courses |
| `sessions` | id | Learning session records |
| `lego_progress` | id | Per-LEGO progress tracking |
| `seed_progress` | id | Per-seed progress tracking |

## Schools & Organization

| Table | PK | Purpose |
|-------|-----|---------|
| `schools` | id (UUID) | School records — school_name, admin_user_id, teacher_join_code, admin_join_code, group_id, region_code |
| `classes` | id (UUID) | Classroom records — class_name, course_code, teacher_user_id, student_join_code |
| `regions` | code (text) | Geographic regions (wales, ireland, etc.) |
| `groups` | id (UUID) | Hierarchical grouping for entitlement cascade |
| `govt_admins` | id | Government administrator records — user_id, region_code |

## Codes & Entitlements

| Table | PK | Purpose |
|-------|-----|---------|
| `invite_codes` | id | Role-based invite codes — code_type: ssi_admin, god, govt_admin, school_admin, school_admin_join, teacher, student, tester |
| `entitlement_codes` | id | Course access codes — access_type, granted_courses, duration |
| `entitlement_grants` | id | Group/school/class level course grants |

## Views (read-only)

| View | Purpose |
|------|---------|
| `invite_code_validation` | Safe view for validating invite codes without auth |
| `entitlement_code_validation` | Safe view for validating entitlement codes without auth |
| `school_summary` | Aggregated school stats |
| `region_summary` | Aggregated region/group stats |
| `class_activity_stats` | Class-level activity metrics |
| `class_student_progress` | Per-student progress within classes |
| `demographic_cycle_averages` | Benchmark averages by school/region/course level |

## Subscriptions

| Table | PK | Purpose |
|-------|-----|---------|
| `subscriptions` | id | LemonSqueezy subscription status |

## RPC Functions

| Function | Purpose |
|----------|---------|
| `get_cascade_courses(user_id)` | Returns effective course codes via entitlement cascade |
| `get_my_verified_emails()` | Returns current user's verified emails (SECURITY DEFINER) |
| `find_learner_by_email(email)` | Finds learner by email for auth linking (SECURITY DEFINER) |
| `get_staff_with_emails()` | Returns staff with primary email (SECURITY DEFINER) |
| `generate_join_code()` | Generates XXX-NNN format join codes |

## RLS Status

**ALL RLS is currently DISABLED** (migration `20260326100000_disable_all_rls.sql`).

Column-level REVOKE on `learners.verified_emails` for anon/authenticated roles (migration `20260401150001_column_security_step2_revoke.sql`). Use RPC functions to access emails.
