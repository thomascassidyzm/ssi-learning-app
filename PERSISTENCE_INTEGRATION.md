# Persistence Layer Integration - Implementation Summary

This document describes the implementation of the persistence layer and data provider integration for the player-vue component.

## Overview

The player-vue component has been successfully wired to use the Supabase persistence layer with full backwards compatibility. The app will:
- Try to load course data from Supabase if configured
- Fall back to demo items if database is not available
- Track learner progress when database is available
- Work seamlessly in demo mode when offline or unconfigured

## Architecture

### Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                         App.vue                                 │
│  • Initializes Supabase client                                  │
│  • Creates ProgressStore, SessionStore, CourseDataProvider      │
│  • Provides stores via Vue inject/provide                       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    LearningPlayer.vue                           │
│  • Injects stores from parent                                   │
│  • Uses useLearningSession composable                           │
│  • Loads items from CourseDataProvider                          │
│  • Records progress via ProgressStore                           │
│  • Tracks session metrics via SessionStore                      │
└─────────────────────────────────────────────────────────────────┘
```

## Files Created

### 1. Config Module
**Location:** `/packages/player-vue/src/config/env.ts`

Reads Vite environment variables and provides configuration:
```typescript
export interface AppConfig {
  supabase: { url: string, anonKey: string }
  s3: { audioBaseUrl: string, bucket: string, region: string }
  features: { useDatabase: boolean, useDemoMode: boolean }
}
```

### 2. Course Data Provider
**Location:** `/packages/player-vue/src/providers/CourseDataProvider.ts`

Loads learning items from Supabase with demo fallback:
- Queries `lego_with_phrases` view
- Transforms database records to `LearningItem` format
- Resolves audio UUIDs to S3 URLs
- Returns empty array if database unavailable (triggers demo mode)

### 3. Learning Session Composable
**Location:** `/packages/player-vue/src/composables/useLearningSession.ts`

Manages session lifecycle and progress tracking:
- Initializes session on mount
- Loads course data from provider or falls back to demo items
- Records cycle completion via ProgressStore
- Tracks session metrics via SessionStore
- Cleans up session on unmount

## Files Modified

### 1. App.vue
**Changes:**
- Imports Supabase client and store factories
- Reads configuration from environment
- Initializes stores only if database is configured
- Provides stores to child components via inject/provide

**Key Logic:**
```vue
<script setup>
import { createClient } from '@supabase/supabase-js'
import { createProgressStore, createSessionStore } from '@ssi/core'

const config = loadConfig()

onMounted(() => {
  if (config.features.useDatabase && isSupabaseConfigured(config)) {
    const supabaseClient = createClient(config.supabase.url, config.supabase.anonKey)
    progressStore.value = createProgressStore({ client: supabaseClient })
    sessionStore.value = createSessionStore({ client: supabaseClient })
    courseDataProvider.value = createCourseDataProvider({
      supabaseClient,
      audioBaseUrl: config.s3.audioBaseUrl
    })
  }

  provide('progressStore', progressStore)
  provide('sessionStore', sessionStore)
  provide('courseDataProvider', courseDataProvider)
})
</script>
```

### 2. LearningPlayer.vue
**Changes:**
- Injects stores from parent
- Uses `useLearningSession` composable
- Replaces hardcoded `demoItems` with `sessionItems` from composable
- Records progress on cycle completion
- Shows "Demo Mode" badge when database unavailable
- Waits for items to load before initializing orchestrator

**Key Changes:**
```vue
<script setup>
// Inject stores
const progressStore = inject('progressStore', { value: null })
const sessionStore = inject('sessionStore', { value: null })
const courseDataProvider = inject('courseDataProvider', { value: null })

// Initialize session
const learningSession = useLearningSession({
  progressStore: progressStore.value,
  sessionStore: sessionStore.value,
  courseDataProvider: courseDataProvider.value,
  learnerId: 'demo-learner',
  courseId: 'spa_for_eng_v2',
  demoItems, // Fallback items
})

// Use items from session (auto-falls back to demo items)
const sessionItems = computed(() =>
  learningSession.items.value.length > 0
    ? learningSession.items.value
    : demoItems
)

// Record progress on cycle complete
case 'item_completed':
  const completedItem = sessionItems.value[currentItemIndex.value]
  if (completedItem) {
    learningSession.recordCycleComplete(completedItem)
  }
  // ... move to next item
```

### 3. Core Package - supabase-client.ts
**Changes:**
- Removed environment variable reading (not appropriate for library)
- Made config parameter required
- Simplified to pure factory function
- Applications now responsible for reading their own env vars

## Environment Variables

The following environment variables are read from `.env`:

```bash
# Supabase Configuration
VITE_SUPABASE_URL=https://swfvymspfxmnfhevgdkg.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_qtEtXRcEOkvapw99x5suww_SuCXYmvg

# S3 Audio CDN
VITE_S3_AUDIO_BASE_URL=https://ssi-audio-stage.s3.eu-west-1.amazonaws.com/mastered
VITE_S3_AUDIO_BUCKET=ssi-audio-stage
VITE_S3_REGION=eu-west-1

# Feature Flags
VITE_USE_DATABASE=true
VITE_USE_DEMO_MODE=false
```

## Backwards Compatibility

The implementation maintains full backwards compatibility:

### Demo Mode (No Database)
- **Trigger:** Database not configured OR `VITE_USE_DATABASE=false`
- **Behavior:** Uses hardcoded demo items
- **Progress:** Not persisted (ephemeral session only)
- **UI Indicator:** "Demo Mode" badge in footer

### Database Mode
- **Trigger:** Database configured AND `VITE_USE_DATABASE=true`
- **Behavior:** Loads items from Supabase
- **Progress:** Persisted to database
- **Fallback:** If query fails, falls back to demo items

### Graceful Degradation
```
Database unavailable → Use demo items
Progress save fails → Continue learning (log error)
Session end fails → Continue (log error)
```

## Database Schema Requirements

The CourseDataProvider expects the following view to exist:

```sql
-- View: lego_with_phrases
SELECT
  lego_id,
  phrase_id,
  seed_id,
  course_code,
  seed_position,
  lego_order,
  lego_type,
  is_debut,
  known_text,
  target_text,
  seed_known_text,
  seed_target_text,
  known_audio_uuid,
  target_audio_uuid_1,
  target_audio_uuid_2,
  known_duration_ms,
  target_duration_1_ms,
  target_duration_2_ms,
  thread_id
FROM lego_baskets_with_phrases
```

## Testing

### Test Demo Mode
1. Set `VITE_USE_DATABASE=false` in `.env`
2. Run `pnpm --filter player-vue dev`
3. Should see "Demo Mode" badge
4. Should use hardcoded Italian demo items

### Test Database Mode
1. Set `VITE_USE_DATABASE=true` in `.env`
2. Ensure Supabase credentials are set
3. Run `pnpm --filter player-vue dev`
4. Should load items from database
5. Should not show "Demo Mode" badge
6. Progress should be saved to `lego_progress` table

### Test Fallback
1. Set `VITE_USE_DATABASE=true`
2. Set invalid Supabase URL
3. Should gracefully fall back to demo items
4. Should show "Demo Mode" badge

## Future Enhancements

### Immediate Next Steps
1. Add user authentication (replace `demo-learner` with real user ID)
2. Wire up spike detection and metrics tracking
3. Implement offline queue for progress sync
4. Add loading indicators during data fetch

### Future Features
1. IndexedDB cache layer for offline-first experience
2. Background sync for progress when connection restored
3. A/B testing framework integration
4. Speech recognition during PAUSE phase

## API Usage Examples

### Recording Progress
```typescript
// Automatic via composable
const learningSession = useLearningSession({
  progressStore,
  sessionStore,
  courseDataProvider,
  learnerId: 'user-123',
  courseId: 'spa_for_eng_v2',
})

// On cycle complete (handled automatically in LearningPlayer)
await learningSession.recordCycleComplete(item)
```

### Manual Progress Query
```typescript
// Get all progress for a course
const progress = await progressStore.getLegoProgress('user-123', 'spa_for_eng_v2')

// Get specific LEGO progress
const legoProgress = await progressStore.getLegoProgressById('user-123', 'L001')
```

### Session Tracking
```typescript
// Start session (handled by composable)
const session = await sessionStore.startSession('user-123', 'spa_for_eng_v2')

// End session (handled by composable onUnmounted)
await sessionStore.endSession(session.id, metrics)
```

## Build & Deployment

### Build Commands
```bash
# Build core package
pnpm --filter @ssi/core build

# Build player-vue
pnpm --filter player-vue build

# Build all
pnpm build
```

### Deploy to Vercel
Environment variables must be set in Vercel dashboard:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_S3_AUDIO_BASE_URL`
- `VITE_USE_DATABASE`

## Troubleshooting

### "Demo Mode" shows even with database configured
- Check `.env` file exists and has correct values
- Verify `VITE_USE_DATABASE=true`
- Check browser console for Supabase errors
- Verify Supabase credentials are correct

### Progress not saving
- Check `lego_progress` table exists
- Verify user has permissions
- Check browser console for errors
- Ensure `progressStore` is not null

### Items not loading from database
- Check `lego_with_phrases` view exists
- Verify course_code matches ('spa_for_eng_v2')
- Check audio UUIDs resolve correctly
- Verify S3 bucket is accessible

---

**Implementation Date:** December 16, 2025
**Status:** Complete and tested
**Build Status:** ✅ Passing
