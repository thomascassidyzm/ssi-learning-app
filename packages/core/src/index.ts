/**
 * @ssi/core - Framework-agnostic TypeScript core for SSi Language Learning
 *
 * This package contains all the business logic for the learning engine,
 * with no UI framework dependencies.
 */

// Configuration
export * from './config';

// Data types
export * from './data';

// Engine (cycle phases, audio-controller interfaces)
export * from './engine';

// Learning algorithms (SpacedRepetition, TripleHelix)
export * from './learning';

// Data persistence (Supabase)
export * from './persistence';

// Audio analysis (VAD, Prosody)
export * from './audio';

// Pricing (Big 10 languages, access control)
export * from './pricing';

// Course display names (code → "French for English speakers")
export * from './courses';

// Script generation (unified main-loop + INF PLAY generator, CourseBundle wire format)
export * from './script';

// Text measurement (per-language syllable counting registry)
export * from './text';
