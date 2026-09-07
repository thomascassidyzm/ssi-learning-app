/**
 * The parser that reads Tom's redlines back out of the Popty document.
 *
 * The thing it must never do is show a teacher the editor's scaffolding —
 * headings, notes to themselves, rules — as if it were copy.
 */
import { describe, it, expect } from 'vitest'
import { parseMailboxCopy } from './usePublishedMailboxCopy'

const DOC = `# When we ask a teacher whether their mailbox reaches them

Preamble for whoever is editing, which is not copy.

---

## The card, in the order a teacher meets it

### The card's title

\`title\`

Can we reach you here?

### The opening line

*A note to the editor, which is context and not copy.*

\`lead\`

Quick one — schools' spam filters are ferocious.

### The way out

\`dismiss\`

Not now
`

describe('parseMailboxCopy', () => {
  it('reads the keyed lines and nothing else', () => {
    expect(parseMailboxCopy(DOC)).toEqual({
      title: 'Can we reach you here?',
      lead: "Quick one — schools' spam filters are ferocious.",
      dismiss: 'Not now',
    })
  })

  it('returns nothing at all from a document with no keys, so the floor stands', () => {
    expect(parseMailboxCopy('# Just a heading\n\nand a paragraph.')).toEqual({})
  })
})
