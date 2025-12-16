/**
 * Example: Using CourseDataProvider to load course content
 *
 * This example demonstrates how to:
 * 1. Create a Supabase client
 * 2. Initialize a CourseDataProvider
 * 3. Load session content
 * 4. Access SEEDs, LEGOs, and practice phrases
 */

import { createClient, createCourseDataProvider } from './index';

/**
 * Example 1: Basic session loading
 */
export async function loadBasicSession() {
  // Create Supabase client
  const supabase = createClient({
    url: 'https://your-project.supabase.co',
    anonKey: 'your-anon-key',
  });

  // Create data provider
  const provider = createCourseDataProvider(supabase, 'spa_for_eng_v2', true);

  // Load first 30 seeds
  const content = await provider.getSessionContent({
    startPosition: 1,
    endPosition: 30,
  });

  console.log('Session Content:', {
    seeds: content.seeds.length,
    totalLegos: content.totalLegos,
    estimatedMinutes: Math.round(content.estimatedDurationSeconds / 60),
  });

  return content;
}

/**
 * Example 2: Iterating through session content
 */
export async function iterateSessionContent() {
  const supabase = createClient({
    url: 'https://your-project.supabase.co',
    anonKey: 'your-anon-key',
  });

  const provider = createCourseDataProvider(supabase, 'spa_for_eng_v2');

  const content = await provider.getSessionContent({
    startPosition: 1,
    endPosition: 30,
  });

  // Iterate through seeds
  for (const seed of content.seeds) {
    console.log(`\nSeed ${seed.seed_id}: "${seed.seed_pair.target}"`);

    // Iterate through LEGOs in this seed
    for (const lego of seed.legos) {
      console.log(`  LEGO ${lego.id}: "${lego.lego.target}" (${lego.type})`);

      // Get practice phrases for this LEGO
      const practices = content.practices.get(lego.id) || [];
      console.log(`    ${practices.length} practice phrases`);

      // Show first practice phrase
      if (practices.length > 0) {
        const practice = practices[0];
        console.log(`      "${practice.phrase.target}" (${practice.phraseType})`);
      }
    }
  }
}

/**
 * Example 3: Loading specific LEGOs
 */
export async function loadSpecificLego() {
  const supabase = createClient({
    url: 'https://your-project.supabase.co',
    anonKey: 'your-anon-key',
  });

  const provider = createCourseDataProvider(supabase, 'spa_for_eng_v2');

  // Get a specific LEGO with its practice phrases
  const result = await provider.getLegoPairWithPractices('S0001L01');

  if (result) {
    console.log('LEGO:', result.lego.lego.target);
    console.log('Type:', result.lego.type);
    console.log('Practices:', result.practices.length);

    for (const practice of result.practices) {
      console.log(`  - ${practice.phrase.target} (${practice.phraseType})`);
    }
  }
}

/**
 * Example 4: Audio URL access
 */
export async function accessAudioUrls() {
  const supabase = createClient({
    url: 'https://your-project.supabase.co',
    anonKey: 'your-anon-key',
  });

  const provider = createCourseDataProvider(supabase, 'spa_for_eng_v2');

  const content = await provider.getSessionContent({
    startPosition: 1,
    endPosition: 1, // Just first seed for this example
  });

  const firstSeed = content.seeds[0];
  const firstLego = firstSeed.legos[0];

  console.log('Audio URLs for LEGO:', firstLego.id);
  console.log('  Known:', firstLego.audioRefs.known.url);
  console.log('  Target Voice 1:', firstLego.audioRefs.target.voice1.url);
  console.log('  Target Voice 2:', firstLego.audioRefs.target.voice2.url);

  // Duration information (if available)
  if (firstLego.audioRefs.known.duration_ms) {
    console.log('  Known duration:', firstLego.audioRefs.known.duration_ms, 'ms');
  }
}

/**
 * Example 5: Minimal load (no practices, no audio metadata)
 */
export async function minimalLoad() {
  const supabase = createClient({
    url: 'https://your-project.supabase.co',
    anonKey: 'your-anon-key',
  });

  const provider = createCourseDataProvider(supabase, 'spa_for_eng_v2');

  // Load only seeds and LEGOs, skip practices and audio metadata
  const content = await provider.getSessionContent({
    startPosition: 1,
    endPosition: 30,
    includePractices: false,
    includeAudio: false,
  });

  console.log('Minimal load:', {
    seeds: content.seeds.length,
    totalLegos: content.totalLegos,
    practices: content.practices.size, // Should be 0
  });
}

/**
 * Example 6: Error handling
 */
export async function withErrorHandling() {
  try {
    const supabase = createClient({
      url: 'https://your-project.supabase.co',
      anonKey: 'your-anon-key',
    });

    const provider = createCourseDataProvider(supabase, 'spa_for_eng_v2');

    const content = await provider.getSessionContent({
      startPosition: 1,
      endPosition: 30,
    });

    console.log('Success:', content.totalLegos, 'LEGOs loaded');
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('No seeds found')) {
        console.error('Course content not available for this range');
      } else if (error.message.includes('Failed to fetch')) {
        console.error('Database connection error:', error.message);
      } else {
        console.error('Unexpected error:', error.message);
      }
    }
  }
}

/**
 * Example 7: Get course statistics
 */
export async function getCourseStats() {
  const supabase = createClient({
    url: 'https://your-project.supabase.co',
    anonKey: 'your-anon-key',
  });

  const provider = createCourseDataProvider(supabase, 'spa_for_eng_v2');

  // Get total number of seeds in course
  const totalSeeds = await provider.getTotalSeeds();

  console.log('Course Statistics:');
  console.log('  Total Seeds:', totalSeeds);

  // Load all content to get total LEGOs
  const content = await provider.getSessionContent({
    startPosition: 1,
    endPosition: totalSeeds,
    includePractices: false,
    includeAudio: false,
  });

  console.log('  Total LEGOs:', content.totalLegos);
}

// Usage in a Vite app:
//
// In your Vue/React component:
/*
import { createClient, createCourseDataProvider } from '@ssi/core/data';

export default {
  async setup() {
    const supabase = createClient({
      url: import.meta.env.VITE_SUPABASE_URL,
      anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY
    });

    const provider = createCourseDataProvider(supabase, 'spa_for_eng_v2');

    const content = await provider.getSessionContent({
      startPosition: 1,
      endPosition: 30
    });

    return { content };
  }
}
*/
