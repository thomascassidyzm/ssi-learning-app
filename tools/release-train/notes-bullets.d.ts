// Hand-written types for notes-bullets.mjs — the player-vue bundle imports the .mjs directly
// (same reach across the package boundary that trainReleaseNotes.ts already makes to glob the
// notes files), and vue-tsc needs a declaration to follow it.
export declare function unrenderableMarkup(bullet: string): string[]
export declare function findUnrenderable(
  bullets: string[],
): Array<{ bullet: string; problems: string[] }>
export declare function extractBullets(body: string, heading: string): string[]
export declare const MAX_HEADLINES: number
export declare const HEADLINE_MAX_CHARS: number
export declare const READMORE_MAX_CHARS: number
export declare const SHAPE_RULING_DATE: string
export declare function isOneSentence(bullet: string): boolean
export declare function shapeProblems(bullet: string, kind: 'headline' | 'readmore'): string[]
export declare function findOffShape(
  bullets: string[],
  kind: 'headline' | 'readmore',
): Array<{ bullet: string; problems: string[] }>
