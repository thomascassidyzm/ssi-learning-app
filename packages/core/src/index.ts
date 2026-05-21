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

// Engine (CycleOrchestrator, AudioController)
export * from './engine';

// Learning algorithms (SpacedRepetition, TripleHelix)
export * from './learning';

// Data persistence (Supabase)
export * from './persistence';

// Audio analysis (VAD, Prosody)
export * from './audio';

// Pricing (Big 10 languages, access control)
export * from './pricing';

// Network engine (brain view) — structural + context edge builder
export * from './network';
