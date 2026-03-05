/**
 * Shared utilities for admin dashboard views.
 */

import { BELTS } from '@/composables/useBeltProgress'

// ISO 639-3 language codes to display names
export const LANGUAGE_NAMES: Record<string, string> = {
  eng: 'English',
  spa: 'Spanish',
  fra: 'French',
  deu: 'German',
  ita: 'Italian',
  por: 'Portuguese',
  zho: 'Chinese',
  jpn: 'Japanese',
  ara: 'Arabic',
  kor: 'Korean',
  nld: 'Dutch',
  gle: 'Irish',
  cym: 'Welsh',
  eus: 'Basque',
  cat: 'Catalan',
  rus: 'Russian',
  hin: 'Hindi',
  tur: 'Turkish',
  pol: 'Polish',
  swe: 'Swedish',
}

export interface ParsedCourseCode {
  target: string
  known: string
  label: string
}

/**
 * Parse a course code like "fra_for_eng" into { target, known, label }
 */
export function parseCourseCode(code: string): ParsedCourseCode {
  const parts = code.split('_for_')
  if (parts.length !== 2) {
    return { target: code, known: '', label: code }
  }
  const [target, known] = parts
  const targetName = LANGUAGE_NAMES[target] || target
  const knownName = LANGUAGE_NAMES[known] || known
  return {
    target,
    known,
    label: `${targetName} for ${knownName}`,
  }
}

/**
 * Get the belt name and color for a given seed count.
 * Reuses thresholds from useBeltProgress.
 */
export function getBeltForSeeds(seeds: number): { name: string; color: string } {
  for (let i = BELTS.length - 1; i >= 0; i--) {
    if (seeds >= BELTS[i].seedsRequired) {
      return { name: BELTS[i].name, color: BELTS[i].color }
    }
  }
  return { name: 'white', color: '#ffffff' }
}

/**
 * Format a date as relative time (e.g., "2h ago", "3d ago")
 */
export function timeAgo(date: string | Date): string {
  const now = Date.now()
  const then = new Date(date).getTime()
  const seconds = Math.floor((now - then) / 1000)

  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`
  return new Date(date).toLocaleDateString()
}

/**
 * Format minutes into a human-readable duration
 */
export function formatDuration(minutes: number): string {
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${Math.round(minutes)}m`
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}
