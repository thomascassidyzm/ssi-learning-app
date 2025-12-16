# Integration Guide: Database-First Architecture

This guide shows how to integrate the new CourseDataProvider into existing applications.

## For player-vue (Current Demo)

### Step 1: Install Dependencies

Dependencies are already installed in the monorepo. Just ensure the core package is built:

```bash
pnpm --filter @ssi/core build
```

### Step 2: Environment Variables

Create `.env` file in the player-vue directory:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

### Step 3: Replace Manifest Loading

**Before (Manifest-based):**
```typescript
// In your component or store
const manifest = await fetch('/course_manifest.json').then(r => r.json());
const seeds = manifest.seeds;
```

**After (Database-first):**
```typescript
import { createClient, createCourseDataProvider } from '@ssi/core/data';

// Create client once (e.g., in a composable or store)
const supabase = createClient({
  url: import.meta.env.VITE_SUPABASE_URL,
  anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY
});

const provider = createCourseDataProvider(supabase, 'spa_for_eng_v2');

// Load session content
const content = await provider.getSessionContent({
  startPosition: 1,
  endPosition: 30
});

const seeds = content.seeds;
```

### Step 4: Update LearningPlayer Component

**In `packages/player-vue/src/components/LearningPlayer.vue`:**

```typescript
<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { createClient, createCourseDataProvider } from '@ssi/core/data';
import type { SessionContent } from '@ssi/core/data';

const content = ref<SessionContent | null>(null);
const loading = ref(true);

onMounted(async () => {
  try {
    const supabase = createClient({
      url: import.meta.env.VITE_SUPABASE_URL,
      anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY
    });

    const provider = createCourseDataProvider(supabase, 'spa_for_eng_v2', true);

    content.value = await provider.getSessionContent({
      startPosition: 1,
      endPosition: 30
    });

    console.log(`Loaded ${content.value.totalLegos} LEGOs`);
  } catch (error) {
    console.error('Failed to load content:', error);
  } finally {
    loading.value = false;
  }
});
</script>
```

### Step 5: Update TripleHelixEngine Usage

The engine already accepts `SeedPair[]`, so no changes needed:

```typescript
import { TripleHelixEngine } from '@ssi/core/learning';

// After loading content
const engine = new TripleHelixEngine(content.value.seeds);
```

## For apps/web (New PWA)

### Complete Setup

**1. Create composables/useSupabase.ts:**
```typescript
import { ref } from 'vue';
import { createClient } from '@ssi/core/data';
import type { SupabaseClient } from '@supabase/supabase-js';

let supabaseInstance: SupabaseClient | null = null;

export function useSupabase() {
  if (!supabaseInstance) {
    supabaseInstance = createClient({
      url: import.meta.env.VITE_SUPABASE_URL,
      anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY
    });
  }

  return {
    supabase: supabaseInstance
  };
}
```

**2. Create composables/useCourseData.ts:**
```typescript
import { ref, computed } from 'vue';
import { createCourseDataProvider } from '@ssi/core/data';
import type { SessionContent } from '@ssi/core/data';
import { useSupabase } from './useSupabase';

export function useCourseData(courseCode: string) {
  const { supabase } = useSupabase();
  const provider = createCourseDataProvider(supabase, courseCode);

  const content = ref<SessionContent | null>(null);
  const loading = ref(false);
  const error = ref<Error | null>(null);

  const totalLegos = computed(() => content.value?.totalLegos || 0);
  const totalSeeds = computed(() => content.value?.seeds.length || 0);
  const estimatedMinutes = computed(() =>
    Math.round((content.value?.estimatedDurationSeconds || 0) / 60)
  );

  async function loadSession(startPos: number, endPos: number) {
    loading.value = true;
    error.value = null;

    try {
      content.value = await provider.getSessionContent({
        startPosition: startPos,
        endPosition: endPos
      });
    } catch (e) {
      error.value = e as Error;
      throw e;
    } finally {
      loading.value = false;
    }
  }

  return {
    content,
    loading,
    error,
    totalLegos,
    totalSeeds,
    estimatedMinutes,
    loadSession,
    provider
  };
}
```

**3. Use in components:**
```vue
<script setup lang="ts">
import { onMounted } from 'vue';
import { useCourseData } from '@/composables/useCourseData';

const { content, loading, loadSession, totalLegos, estimatedMinutes } =
  useCourseData('spa_for_eng_v2');

onMounted(async () => {
  await loadSession(1, 30);
});
</script>

<template>
  <div v-if="loading">Loading...</div>
  <div v-else-if="content">
    <p>{{ totalLegos }} LEGOs loaded</p>
    <p>Estimated time: {{ estimatedMinutes }} minutes</p>
    <!-- Use content.seeds in your learning UI -->
  </div>
</template>
```

## React Integration

### Custom Hook

**hooks/useCourseData.ts:**
```typescript
import { useState, useCallback } from 'react';
import { createClient, createCourseDataProvider } from '@ssi/core/data';
import type { SessionContent } from '@ssi/core/data';

const supabase = createClient({
  url: import.meta.env.VITE_SUPABASE_URL!,
  anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY!
});

export function useCourseData(courseCode: string) {
  const [content, setContent] = useState<SessionContent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const provider = createCourseDataProvider(supabase, courseCode);

  const loadSession = useCallback(async (startPos: number, endPos: number) => {
    setLoading(true);
    setError(null);

    try {
      const sessionContent = await provider.getSessionContent({
        startPosition: startPos,
        endPosition: endPos
      });
      setContent(sessionContent);
    } catch (e) {
      setError(e as Error);
      throw e;
    } finally {
      setLoading(false);
    }
  }, [provider]);

  return {
    content,
    loading,
    error,
    loadSession
  };
}
```

**Usage in component:**
```typescript
import { useEffect } from 'react';
import { useCourseData } from './hooks/useCourseData';

export function LearningSession() {
  const { content, loading, loadSession } = useCourseData('spa_for_eng_v2');

  useEffect(() => {
    loadSession(1, 30);
  }, [loadSession]);

  if (loading) return <div>Loading...</div>;
  if (!content) return <div>No content</div>;

  return (
    <div>
      <h1>{content.totalLegos} LEGOs</h1>
      {/* Render learning UI */}
    </div>
  );
}
```

## Offline Support with IndexedDB

### Caching Strategy

```typescript
import { OfflineCache } from '@ssi/core/cache';
import { useCourseData } from './composables/useCourseData';

const cache = new OfflineCache('ssi-course-data');

async function loadWithCache(startPos: number, endPos: number) {
  // Try cache first
  const cacheKey = `session_${startPos}_${endPos}`;
  const cached = await cache.get(cacheKey);

  if (cached && isFresh(cached)) {
    return cached.content;
  }

  // Load from database
  const { loadSession } = useCourseData('spa_for_eng_v2');
  const content = await loadSession(startPos, endPos);

  // Cache for offline
  await cache.set(cacheKey, {
    content,
    timestamp: Date.now()
  });

  return content;
}

function isFresh(cached: any) {
  const ONE_HOUR = 60 * 60 * 1000;
  return Date.now() - cached.timestamp < ONE_HOUR;
}
```

## Error Handling

### Graceful Degradation

```typescript
import { createClient, createCourseDataProvider } from '@ssi/core/data';

async function loadContent() {
  try {
    const supabase = createClient({
      url: import.meta.env.VITE_SUPABASE_URL,
      anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY
    });

    const provider = createCourseDataProvider(supabase, 'spa_for_eng_v2');
    return await provider.getSessionContent({
      startPosition: 1,
      endPosition: 30
    });
  } catch (error) {
    console.error('Database load failed, falling back to manifest:', error);

    // Fallback to static manifest
    const manifest = await fetch('/course_manifest.json').then(r => r.json());
    return {
      seeds: manifest.seeds,
      practices: new Map(),
      totalLegos: countLegos(manifest.seeds),
      estimatedDurationSeconds: 0
    };
  }
}
```

## Performance Optimization

### Lazy Loading Practices

```typescript
// Load structure first, practices on demand
const content = await provider.getSessionContent({
  startPosition: 1,
  endPosition: 30,
  includePractices: false,  // Skip initially
  includeAudio: false       // Skip initially
});

// Later, when user starts a LEGO, load its practices
async function startLego(legoId: string) {
  const result = await provider.getLegoPairWithPractices(legoId);
  if (result) {
    // Use result.practices
  }
}
```

### Prefetching Next Session

```typescript
let currentSession = 1;
let nextSessionPromise: Promise<SessionContent> | null = null;

async function loadCurrentSession() {
  const start = (currentSession - 1) * 30 + 1;
  const end = start + 29;

  const content = await provider.getSessionContent({
    startPosition: start,
    endPosition: end
  });

  // Prefetch next session in background
  prefetchNextSession();

  return content;
}

function prefetchNextSession() {
  const nextStart = currentSession * 30 + 1;
  const nextEnd = nextStart + 29;

  nextSessionPromise = provider.getSessionContent({
    startPosition: nextStart,
    endPosition: nextEnd
  });
}

async function advanceToNextSession() {
  currentSession++;

  if (nextSessionPromise) {
    const content = await nextSessionPromise;
    nextSessionPromise = null;
    prefetchNextSession();
    return content;
  } else {
    return loadCurrentSession();
  }
}
```

## Testing

### Mock Provider

```typescript
import { vi } from 'vitest';
import type { CourseDataProvider } from '@ssi/core/data';

function createMockProvider(): CourseDataProvider {
  return {
    getSessionContent: vi.fn().mockResolvedValue({
      seeds: [],
      practices: new Map(),
      totalLegos: 0,
      estimatedDurationSeconds: 0
    }),
    getSeedsByPositionRange: vi.fn().mockResolvedValue([]),
    getLegosBySeedId: vi.fn().mockResolvedValue([]),
    // ... other methods
  } as any;
}

// Use in tests
const mockProvider = createMockProvider();
```

## Environment Variables

Required for all apps:

```env
# .env or .env.local
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

For production, set these in Vercel:
1. Go to project settings
2. Environment Variables
3. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
4. Redeploy

## Migration Checklist

- [ ] Add environment variables (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)
- [ ] Build @ssi/core package
- [ ] Create Supabase client instance
- [ ] Replace manifest loading with CourseDataProvider
- [ ] Test session loading
- [ ] Implement error handling with fallback
- [ ] Add offline caching (optional)
- [ ] Update tests with mock provider
- [ ] Deploy with environment variables

## Support

For issues or questions:
1. Check `/packages/core/src/data/README.md` for API documentation
2. See `/packages/core/src/data/EXAMPLE.ts` for code examples
3. Review `/IMPLEMENTATION_SUMMARY.md` for architecture details
