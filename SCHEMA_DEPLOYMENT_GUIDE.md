# Learner Schema Deployment Guide

## Overview
This guide explains how to deploy the learner progress tracking schema to your Supabase database.

## Quick Start (Recommended Method)

### Using Supabase SQL Editor

1. **Open the SQL Editor**
   - Navigate to: https://supabase.com/dashboard/project/swfvymspfxmnfhevgdkg/sql
   - Log in to your Supabase account

2. **Create New Query**
   - Click the "New Query" button
   - Give it a name like "Deploy Learner Schema"

3. **Paste the Schema**
   - Open the file: `/Users/tomcassidy/SSi/ssi-learning-app/schema_deploy_ready.sql`
   - Copy the entire contents
   - Paste into the SQL Editor

4. **Execute**
   - Click "Run" (or press `Cmd+Enter` on Mac, `Ctrl+Enter` on Windows/Linux)
   - Wait for confirmation

5. **Verify**
   - Check the Tables section in the left sidebar
   - You should see: learners, course_enrollments, lego_progress, etc.

---

## Alternative Methods

### Method 2: Using psql Command Line

If you have PostgreSQL client installed:

```bash
# Get the connection string from Supabase dashboard under Settings > Database
# Then run:
psql "your-connection-string-here" -f schema_deploy_ready.sql
```

### Method 3: Using Supabase CLI

If you have the Supabase CLI installed:

```bash
# Link your project
supabase link --project-ref swfvymspfxmnfhevgdkg

# Run the migration
supabase db push

# Or execute directly
supabase db execute -f schema_deploy_ready.sql
```

### Method 4: Using Node.js Script

A deployment script is available at `/tmp/deploy-pg.js` that uses the `pg` library, but requires the correct database credentials.

---

## What Gets Created

### Tables (8)

1. **learners**
   - User profiles linked to auth.users
   - Stores display name and preferences (session duration, volume, etc.)
   - One learner per user

2. **course_enrollments**
   - Tracks which courses a learner is enrolled in
   - Stores Triple Helix state (3 threads, current positions)
   - Practice time tracking

3. **lego_progress**
   - Individual LEGO tracking
   - Fibonacci spaced repetition positions
   - Retirement status

4. **seed_progress**
   - Tracks which seeds have been introduced
   - Per-thread introduction tracking

5. **sessions**
   - Learning session records
   - Duration, items practiced, spikes detected
   - Links to response metrics

6. **response_metrics**
   - Individual response latency measurements
   - Normalized latency calculations
   - Spike detection flags

7. **spike_events**
   - Records hesitation/difficulty events
   - Tracks spike ratio and response (repeat/breakdown)
   - Used for adaptive learning

### Views (2)

1. **learner_stats**
   - Aggregate statistics per learner
   - Total courses, practice time, sessions
   - Last session timestamp

2. **course_progress**
   - Per-course progress summary
   - LEGOs seen/retired, seeds introduced
   - Practice time per course

### Functions & Triggers

1. **update_updated_at_column()**
   - Auto-updates `updated_at` timestamp on row changes
   - Applied to: learners, lego_progress, seed_progress

2. **handle_new_user()**
   - Automatically creates learner profile when user signs up
   - Triggered on auth.users INSERT

### Security

- **Row Level Security (RLS)** enabled on all tables
- Users can only access their own data
- Policies enforce auth.uid() checks

---

## Schema Structure

```
auth.users (Supabase Auth)
    ↓
learners ─┬─ course_enrollments
          │       ↓
          ├─ lego_progress
          ├─ seed_progress
          └─ sessions ─┬─ response_metrics
                       └─ spike_events
```

---

## Verification Queries

After deployment, run these queries in the SQL Editor to verify:

```sql
-- Check all tables were created
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN (
  'learners',
  'course_enrollments',
  'lego_progress',
  'seed_progress',
  'sessions',
  'response_metrics',
  'spike_events'
)
ORDER BY table_name;

-- Check views
SELECT table_name
FROM information_schema.views
WHERE table_schema = 'public'
AND table_name IN ('learner_stats', 'course_progress');

-- Check RLS is enabled
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
AND tablename LIKE '%learner%' OR tablename LIKE '%progress%' OR tablename = 'sessions';

-- Check triggers
SELECT trigger_name, event_object_table
FROM information_schema.triggers
WHERE trigger_schema = 'public'
ORDER BY event_object_table, trigger_name;
```

---

## Troubleshooting

### "relation already exists" errors
The schema uses `CREATE IF NOT EXISTS` and `CREATE OR REPLACE`, so these are generally safe to ignore. The schema is idempotent.

### "permission denied" errors
Make sure you're using a service role key or logged in as the database owner.

### "auth.users does not exist" errors
This shouldn't happen in Supabase as auth schema is built-in. If you see this, you may not be connected to the right database.

### Trigger errors
If the `on_auth_user_created` trigger fails, you may need to adjust permissions. The function uses `SECURITY DEFINER` to run with elevated privileges.

---

## Files

- **Source Schema**: `/Users/tomcassidy/SSi/ssi-learning-app/packages/core/src/persistence/schema.sql`
- **Deployment-Ready**: `/Users/tomcassidy/SSi/ssi-learning-app/schema_deploy_ready.sql`
- **This Guide**: `/Users/tomcassidy/SSi/ssi-learning-app/SCHEMA_DEPLOYMENT_GUIDE.md`

---

## Next Steps

After deployment:

1. **Test the auto-signup trigger**
   - Create a test user via Supabase Auth
   - Verify a learner record is auto-created

2. **Test RLS policies**
   - Try querying tables with different user contexts
   - Verify users can only see their own data

3. **Integrate with the app**
   - Update `@ssi/core` persistence layer to use these tables
   - Implement ProgressStore and SessionStore with Supabase client

---

## Support

If you encounter issues:
1. Check the Supabase logs in the dashboard
2. Verify your project is on the correct plan (some features require paid plan)
3. Consult Supabase documentation: https://supabase.com/docs

---

Generated: 2025-12-16
Project: SSi Learning App
Database: Supabase (swfvymspfxmnfhevgdkg)
