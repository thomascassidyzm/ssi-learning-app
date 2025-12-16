# Data Module - Supabase Integration

This module provides database access for the SSi Learning App, enabling direct queries to the Supabase database for course content.

## Overview

The data module consists of three main components:

1. **supabase-client.ts** - Creates and configures Supabase client instances
2. **database-types.ts** - Database row types and conversion utilities
3. **CourseDataProvider.ts** - High-level API for querying course content

## Quick Start

### 1. Setup Supabase Client

```typescript
import { createClient } from '@ssi/core/data';

// Create a Supabase client
const supabase = createClient({
  url: 'https://your-project.supabase.co',
  anonKey: 'your-anon-key'
});
```

### 2. Create a Course Data Provider

```typescript
import { createCourseDataProvider } from '@ssi/core/data';

const provider = createCourseDataProvider(
  supabase,
  'spa_for_eng_v2', // course code
  true // debug logging
);
```

### 3. Load Session Content

```typescript
// Load seeds 1-30 (first session)
const content = await provider.getSessionContent({
  startPosition: 1,
  endPosition: 30
});

console.log(`Loaded ${content.totalLegos} LEGOs`);
console.log(`Estimated duration: ${Math.round(content.estimatedDurationSeconds / 60)} minutes`);

// Use the content
for (const seed of content.seeds) {
  console.log(`Seed: ${seed.seed_pair.target}`);

  for (const lego of seed.legos) {
    console.log(`  LEGO: ${lego.lego.target} (${lego.type})`);

    const practices = content.practices.get(lego.id) || [];
    console.log(`    ${practices.length} practice phrases`);
  }
}
```

## API Reference

### `createClient(config, options?)`

Creates a configured Supabase client.

**Parameters:**
- `config: SupabaseConfig` - Required configuration
  - `url: string` - Supabase project URL
  - `anonKey: string` - Supabase anonymous key
  - `schema?: string` - Database schema (default: 'public')
- `options?: ExtendedSupabaseClientOptions` - Optional client configuration
  - `persistSession?: boolean` - Persist auth session (default: true)
  - `autoRefreshToken?: boolean` - Auto-refresh tokens (default: true)
  - `realtime?: boolean` - Enable realtime subscriptions (default: false)

**Returns:** `SupabaseClient`

### `CourseDataProvider`

Main class for querying course data.

#### Constructor

```typescript
new CourseDataProvider({
  supabase: SupabaseClient,
  courseCode: string,
  debug?: boolean
})
```

Or use the factory function:

```typescript
createCourseDataProvider(supabase, courseCode, debug?)
```

#### Methods

##### `getSessionContent(options)`

Loads all content needed for a learning session.

**Parameters:**
```typescript
{
  startPosition: number,      // Starting seed position (inclusive)
  endPosition: number,        // Ending seed position (inclusive)
  includePractices?: boolean, // Include practice phrases (default: true)
  includeAudio?: boolean      // Include audio metadata (default: true)
}
```

**Returns:** `Promise<SessionContent>`
```typescript
{
  seeds: SeedPair[],                    // Seeds with LEGOs
  practices: Map<string, PracticePhrase[]>, // Practice phrases by LEGO ID
  totalLegos: number,                   // Total number of LEGOs
  estimatedDurationSeconds: number      // Estimated session duration
}
```

##### `getSeedsByPositionRange(start, end)`

Fetches seeds by position range.

**Returns:** `Promise<SeedRow[]>`

##### `getLegosBySeedId(seedId)`

Fetches all LEGOs for a specific seed.

**Returns:** `Promise<LegoRow[]>`

##### `getPracticesForLego(legoId)`

Fetches practice phrases for a specific LEGO.

**Returns:** `Promise<PracticePhraseRow[]>`

##### `getSeedPairWithLegos(seedId)`

Builds a complete SeedPair with all LEGOs.

**Returns:** `Promise<SeedPair | null>`

##### `getLegoPairWithPractices(legoId)`

Builds a complete LegoPair with practice phrases.

**Returns:** `Promise<{ lego: LegoPair; practices: PracticePhrase[] } | null>`

##### `getTotalSeeds()`

Gets the total number of seeds in the course.

**Returns:** `Promise<number>`

## Database Schema

The provider queries these tables from the dashboard database:

### `seeds` Table

```sql
- seed_id: string (e.g., 'S0001')
- course_code: string (e.g., 'spa_for_eng_v2')
- position: number (1-indexed)
- known_text: string
- target_text: string
- known_audio_uuid: string | null
- target_audio_uuid: string | null
```

### `legos` Table

```sql
- lego_id: string (e.g., 'S0001L01')
- seed_id: string
- lego_index: number
- known_text: string
- target_text: string
- type: 'A' | 'M' (Atomic or Molecular)
- is_new: boolean
- known_audio_uuid: string | null
- target_audio_uuid: string | null
- target_audio_uuid_alt: string | null (second voice)
- component_of_lego_id: string | null
```

### `lego_practice_phrases` Table

```sql
- phrase_id: string
- lego_id: string
- seed_id: string
- known_text: string
- target_text: string
- phrase_type: 'component' | 'debut' | 'practice' | 'eternal'
- sort_order: number
- word_count: number
- known_audio_uuid: string | null
- target_audio_uuid: string | null
- target_audio_uuid_alt: string | null
```

### `audio_samples` Table

```sql
- uuid: string (primary key)
- s3_key: string
- duration_ms: number
- text: string
- text_normalized: string
- role: 'known' | 'target1' | 'target2'
- voice_id: string | null
- course_code: string
```

## Audio URLs

Audio files are automatically resolved from UUIDs to S3 URLs:

```typescript
import { getAudioUrl, AUDIO_BASE_URL } from '@ssi/core/data';

const url = getAudioUrl('abc-123-def-456');
// => 'https://ssi-audio-stage.s3.eu-west-1.amazonaws.com/mastered/abc-123-def-456.mp3'
```

Base URL: `https://ssi-audio-stage.s3.eu-west-1.amazonaws.com/mastered`

## Type Conversions

The module provides conversion functions to transform database rows into core application types:

```typescript
import {
  convertSeedRowToSeedPair,
  convertLegoRowToLegoPair,
  convertPracticePhraseRowToPracticePhrase,
  buildSeedPairWithLegos,
  groupLegosBySeed
} from '@ssi/core/data';

// Convert individual rows
const seed = convertSeedRowToSeedPair(seedRow);
const lego = convertLegoRowToLegoPair(legoRow);
const practice = convertPracticePhraseRowToPracticePhrase(practiceRow);

// Build complete structures
const completeSeed = buildSeedPairWithLegos(seedRow, legoRows);

// Group LEGOs by parent seed
const grouped = groupLegosBySeed(legoRows);
// => Map<string, LegoRow[]>
```

## Example: Complete Learning Session Setup

```typescript
import { createClient, createCourseDataProvider } from '@ssi/core/data';

async function loadLearningSession() {
  // 1. Create Supabase client
  const supabase = createClient({
    url: process.env.VITE_SUPABASE_URL!,
    anonKey: process.env.VITE_SUPABASE_ANON_KEY!
  });

  // 2. Create data provider
  const provider = createCourseDataProvider(supabase, 'spa_for_eng_v2');

  // 3. Load session content
  const content = await provider.getSessionContent({
    startPosition: 1,
    endPosition: 30
  });

  // 4. Use with learning engine
  console.log('Session loaded:', {
    seeds: content.seeds.length,
    legos: content.totalLegos,
    duration: `${Math.round(content.estimatedDurationSeconds / 60)} min`
  });

  return content;
}
```

## Integration with Learning Engine

The `SessionContent` returned by `getSessionContent()` is designed to work directly with the Triple Helix learning engine:

```typescript
import { TripleHelixEngine } from '@ssi/core/learning';
import { createCourseDataProvider } from '@ssi/core/data';

async function startLearningSession(supabase, courseCode) {
  // Load content
  const provider = createCourseDataProvider(supabase, courseCode);
  const content = await provider.getSessionContent({
    startPosition: 1,
    endPosition: 30
  });

  // Initialize learning engine
  const engine = new TripleHelixEngine(content.seeds);

  // Get next learning item
  const item = engine.next();

  // Practices are available in the content.practices Map
  const practices = content.practices.get(item.lego.id) || [];

  return { engine, content, practices };
}
```

## Error Handling

```typescript
try {
  const content = await provider.getSessionContent({
    startPosition: 1,
    endPosition: 30
  });
} catch (error) {
  if (error.message.includes('No seeds found')) {
    console.error('Course content not available');
  } else {
    console.error('Database error:', error);
  }
}
```

## Debug Logging

Enable debug logging to see detailed query information:

```typescript
const provider = createCourseDataProvider(supabase, 'spa_for_eng_v2', true);

// Or toggle later
provider.setDebug(true);

// Output:
// [CourseDataProvider] Fetching seeds 1-30 for spa_for_eng_v2
// [CourseDataProvider] Found 30 seeds
// [CourseDataProvider] Fetching LEGOs for 30 seeds
// [CourseDataProvider] Found 156 LEGOs
// [CourseDataProvider] Fetching practices for 156 LEGOs
// [CourseDataProvider] Found 468 practice phrases
// [CourseDataProvider] Session loaded: 30 seeds, 156 LEGOs
// [CourseDataProvider] Estimated duration: 780s (13 min)
```

## Performance Considerations

- **Batch queries**: The provider uses `IN` queries to fetch multiple records efficiently
- **Audio metadata**: Optional - set `includeAudio: false` to skip audio sample lookups
- **Practice phrases**: Optional - set `includePractices: false` to skip practice phrase queries
- **Caching**: Consider caching `SessionContent` in IndexedDB for offline use

## Next Steps

- See `packages/core/src/cache/` for offline caching strategies
- See `packages/core/src/learning/` for learning engine integration
- See `packages/core/src/engine/` for the cycle orchestrator that plays audio
