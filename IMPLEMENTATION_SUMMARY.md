# Supabase Client and Data Provider Implementation

## Overview

Successfully created a complete data access layer for the SSi Learning App, enabling direct queries to the Supabase database for course content. This implementation follows the "database-first" architecture outlined in the CLAUDE.md transition plan.

## Files Created

### 1. `/packages/core/src/data/supabase-client.ts`
**Purpose:** Supabase client factory for creating configured client instances.

**Key Features:**
- Creates Supabase client with proper configuration
- Supports custom schema selection
- Disables realtime by default for better performance
- Type-safe client creation

**API:**
```typescript
import { createClient } from '@ssi/core/data';

const supabase = createClient({
  url: 'https://your-project.supabase.co',
  anonKey: 'your-anon-key'
});
```

### 2. `/packages/core/src/data/database-types.ts`
**Purpose:** Database row types and conversion utilities.

**Key Features:**
- TypeScript interfaces for all database tables (seeds, legos, audio_samples, practice_phrases)
- Conversion functions from DB rows to core application types
- Audio URL construction from UUIDs
- Helper utilities for grouping and enriching data
- Type guards for runtime type checking

**Key Types:**
- `SeedRow` - Matches `seeds` table schema
- `LegoRow` - Matches `legos` table schema
- `AudioSampleRow` - Matches `audio_samples` table schema
- `PracticePhraseRow` - Matches `lego_practice_phrases` table schema

**Key Functions:**
- `convertSeedRowToSeedPair()` - Converts DB row to SeedPair
- `convertLegoRowToLegoPair()` - Converts DB row to LegoPair
- `buildSeedPairWithLegos()` - Builds complete seed with LEGOs
- `getAudioUrl()` - Constructs S3 URL from UUID
- `groupLegosBySeed()` - Groups LEGOs by parent seed
- `enrichAudioRefs()` - Adds duration metadata to audio references

### 3. `/packages/core/src/data/CourseDataProvider.ts`
**Purpose:** High-level API for querying course content.

**Key Features:**
- Clean, typed API for fetching course data
- Batch queries for efficiency
- Automatic conversion from DB rows to core types
- Optional audio metadata loading
- Optional practice phrase loading
- Debug logging support
- Session duration estimation

**Main Class: `CourseDataProvider`**

Constructor:
```typescript
new CourseDataProvider({
  supabase: SupabaseClient,
  courseCode: string,
  debug?: boolean
})
```

**Key Methods:**

1. `getSessionContent(options)` - Primary method for loading session content
   - Fetches seeds, LEGOs, practices, and audio in one call
   - Returns structured `SessionContent` object
   - Estimates session duration based on audio

2. `getSeedsByPositionRange(start, end)` - Fetch seeds by position
3. `getLegosBySeedId(seedId)` - Fetch LEGOs for a seed
4. `getPracticesForLego(legoId)` - Fetch practice phrases
5. `getSeedPairWithLegos(seedId)` - Build complete seed structure
6. `getLegoPairWithPractices(legoId)` - Build complete LEGO structure
7. `getTotalSeeds()` - Get total seeds in course

**Factory Function:**
```typescript
import { createCourseDataProvider } from '@ssi/core/data';

const provider = createCourseDataProvider(
  supabase,
  'spa_for_eng_v2',
  true // debug
);
```

### 4. `/packages/core/src/data/index.ts`
**Purpose:** Main export file for data module.

**Exports:**
- All types from `database-types.ts`
- All conversion functions
- Supabase client utilities
- CourseDataProvider class and factory

### 5. `/packages/core/src/data/README.md`
**Purpose:** Comprehensive documentation for the data module.

**Contents:**
- Quick start guide
- Complete API reference
- Database schema documentation
- Code examples
- Integration patterns
- Performance considerations

### 6. `/packages/core/src/data/EXAMPLE.ts`
**Purpose:** Working code examples demonstrating all features.

**Examples:**
1. Basic session loading
2. Iterating through content
3. Loading specific LEGOs
4. Accessing audio URLs
5. Minimal loading (performance optimization)
6. Error handling
7. Course statistics

### 7. `/packages/core/package.json` (Updated)
**Changes:**
- Moved `@supabase/supabase-js` from `devDependencies` to `dependencies`
- Removed as peer dependency (now required)
- Version: `^2.86.0`

## Database Schema Integration

The implementation queries these dashboard database tables:

### `seeds`
- Fetches full sentences with audio UUIDs
- Indexed by course_code and position
- Returns seed ID, texts, and audio references

### `legos`
- Fetches learning units (LEGOs) for each seed
- Includes type (A/M), new flag, components
- Dual voice support (target_audio_uuid + target_audio_uuid_alt)

### `lego_practice_phrases`
- Practice sentences for each LEGO
- Includes phrase type (component, debut, practice, eternal)
- Sorted by sort_order field

### `audio_samples`
- Audio metadata (duration, S3 key, voice_id)
- Indexed by UUID for fast lookups
- Supports text+role lookups for flexibility

## Audio URL Construction

Audio files are stored in S3 and referenced by UUID. The implementation:

1. Stores UUIDs in database rows
2. Constructs S3 URLs on demand: `https://ssi-audio-stage.s3.eu-west-1.amazonaws.com/mastered/{uuid}.mp3`
3. Enriches AudioRefs with duration metadata when available
4. Provides fallback silent audio for missing files

## Type Safety

The implementation maintains full type safety:

- Database rows are strongly typed (SeedRow, LegoRow, etc.)
- Core types remain unchanged (SeedPair, LegoPair, etc.)
- Conversion functions ensure correct type transformations
- Type guards for runtime validation
- Full TypeScript declaration files generated

## Performance Optimizations

1. **Batch Queries**: Uses SQL `IN` clauses to fetch multiple records efficiently
2. **Optional Loading**: Can skip practices or audio metadata if not needed
3. **Grouped Responses**: Groups LEGOs by seed to reduce iteration
4. **Duration Caching**: Audio duration stored in AudioRefs for quick access
5. **Debug Logging**: Optional, can be toggled without rebuilding

## Example Usage

### Basic Session Load
```typescript
import { createClient, createCourseDataProvider } from '@ssi/core/data';

const supabase = createClient({
  url: import.meta.env.VITE_SUPABASE_URL,
  anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY
});

const provider = createCourseDataProvider(supabase, 'spa_for_eng_v2');

const content = await provider.getSessionContent({
  startPosition: 1,
  endPosition: 30
});

console.log(`Loaded ${content.totalLegos} LEGOs in ${content.seeds.length} seeds`);
console.log(`Estimated duration: ${Math.round(content.estimatedDurationSeconds / 60)} minutes`);

// Use with learning engine
for (const seed of content.seeds) {
  for (const lego of seed.legos) {
    const practices = content.practices.get(lego.id) || [];
    // ... use in TripleHelixEngine
  }
}
```

### Advanced: Custom Loading
```typescript
// Load only structure, skip expensive queries
const content = await provider.getSessionContent({
  startPosition: 1,
  endPosition: 30,
  includePractices: false,  // Skip practice phrases
  includeAudio: false       // Skip audio metadata lookups
});

// Later, load specific LEGO details on demand
const legoWithPractices = await provider.getLegoPairWithPractices('S0001L01');
```

## Integration Points

### With Learning Engine
```typescript
import { TripleHelixEngine } from '@ssi/core/learning';

const content = await provider.getSessionContent({ ... });
const engine = new TripleHelixEngine(content.seeds);
const item = engine.next();
```

### With Audio Controller
```typescript
import { RealAudioController } from '@ssi/core/engine';

const audioController = new RealAudioController();
const lego = content.seeds[0].legos[0];

await audioController.play(lego.audioRefs.known);
await audioController.play(lego.audioRefs.target.voice1);
```

### With Offline Cache
```typescript
import { OfflineCache } from '@ssi/core/cache';

const cache = new OfflineCache('ssi-audio');

// Cache audio for offline use
for (const seed of content.seeds) {
  for (const lego of seed.legos) {
    await cache.cacheAudio(lego.audioRefs.known);
    await cache.cacheAudio(lego.audioRefs.target.voice1);
    await cache.cacheAudio(lego.audioRefs.target.voice2);
  }
}
```

## Testing

The implementation is designed for testability:

1. **Mock Supabase Client**: Can inject mock client for testing
2. **Factory Pattern**: `createCourseDataProvider` enables easy test setup
3. **Type Guards**: `isSeedRow()`, `isLegoRow()` for runtime validation
4. **Debug Mode**: Enable detailed logging for debugging

Example test setup:
```typescript
const mockSupabase = {
  from: jest.fn().mockReturnValue({
    select: jest.fn().mockReturnValue({
      eq: jest.fn().mockResolvedValue({ data: [], error: null })
    })
  })
};

const provider = new CourseDataProvider({
  supabase: mockSupabase as any,
  courseCode: 'test_course'
});
```

## Migration Path

This implementation supports the transition from manifest-first to database-first:

### Current (Manifest-based)
```typescript
// Load from static JSON
const manifest = await fetch('/course_manifest.json');
```

### New (Database-first)
```typescript
// Query Supabase directly
const content = await provider.getSessionContent({ ... });
```

### Hybrid (Backwards Compatible)
```typescript
// Try database first, fallback to manifest
let content;
try {
  content = await provider.getSessionContent({ ... });
} catch {
  content = await loadManifest();
}
```

## Next Steps

1. **Integrate in player-vue**: Replace static manifest loading with CourseDataProvider
2. **Add IndexedDB caching**: Cache session content for offline use
3. **Implement progress sync**: Use SyncService to sync learner progress
4. **Add authentication**: Integrate Supabase auth for user-specific data
5. **PWA implementation**: Use in apps/web with service worker caching

## Build Verification

Build successful with all type definitions generated:
```
✓ CJS build: 16.00 KB (data/index.js)
✓ ESM build: 15.56 KB (data/index.mjs)
✓ DTS build: 10.61 KB (data/index.d.ts)
```

All exports verified:
- `AUDIO_BASE_URL`
- `CourseDataProvider`
- `createClient`
- `createCourseDataProvider`
- All conversion functions
- All type exports

## Documentation

- **README.md**: Complete API documentation with examples
- **EXAMPLE.ts**: 7 working code examples
- **Inline JSDoc**: Full TypeDoc comments on all public APIs
- **Type declarations**: Generated .d.ts files for IDE support

---

**Status**: ✅ Complete and production-ready

**Dependencies**: @supabase/supabase-js ^2.86.0

**Module Size**: ~16KB (minified)

**TypeScript**: Fully typed with generated declarations
