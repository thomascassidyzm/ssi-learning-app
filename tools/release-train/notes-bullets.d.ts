// Hand-written types for notes-bullets.mjs — the player-vue bundle imports the .mjs directly
// (same reach across the package boundary that trainReleaseNotes.ts already makes to glob the
// notes files), and vue-tsc needs a declaration to follow it.
export declare function unrenderableMarkup(bullet: string): string[]
export declare function findUnrenderable(
  bullets: string[],
): Array<{ bullet: string; problems: string[] }>
export declare function extractBullets(body: string, heading: string): string[]
