import { describe, it, expect } from 'vitest'
import { renderBoardMarkdown } from './renderBoardMarkdown'
import type { ResolvedMetric } from './boardTokens'

const METRIC: ResolvedMetric = {
  slug: 'schools.total',
  label: 'Schools on platform',
  method: 'Count of schools rows, excluding demo schools.',
  value: 11,
  asOf: '2026-07-15T00:00:00.000Z',
}

describe('renderBoardMarkdown', () => {
  it('parses headings at three levels', () => {
    const blocks = renderBoardMarkdown('# Title\n\n## Section\n\n### Sub', {})
    expect(blocks).toEqual([
      { kind: 'heading', level: 1, segments: [{ type: 'text', text: 'Title' }] },
      { kind: 'heading', level: 2, segments: [{ type: 'text', text: 'Section' }] },
      { kind: 'heading', level: 3, segments: [{ type: 'text', text: 'Sub' }] },
    ])
  })

  it('parses a paragraph with bold and a resolved metric token', () => {
    const blocks = renderBoardMarkdown(
      'We have **{{metric:schools.total}}** schools live.',
      { [METRIC.slug]: METRIC },
    )
    expect(blocks).toEqual([
      {
        kind: 'paragraph',
        segments: [
          { type: 'text', text: 'We have ' },
          { type: 'metric', metric: METRIC, bold: true },
          { type: 'text', text: ' schools live.' },
        ],
      },
    ])
  })

  it('joins a multi-line paragraph into one flowed block', () => {
    const blocks = renderBoardMarkdown('Line one\nLine two continues.', {})
    expect(blocks).toEqual([
      { kind: 'paragraph', segments: [{ type: 'text', text: 'Line one Line two continues.' }] },
    ])
  })

  it('parses a bullet list', () => {
    const blocks = renderBoardMarkdown('- First item\n- Second item', {})
    expect(blocks).toEqual([
      {
        kind: 'list',
        ordered: false,
        items: [
          [{ type: 'text', text: 'First item' }],
          [{ type: 'text', text: 'Second item' }],
        ],
      },
    ])
  })

  it('parses a numbered list', () => {
    const blocks = renderBoardMarkdown('1. First\n2. Second', {})
    expect(blocks).toEqual([
      {
        kind: 'list',
        ordered: true,
        items: [
          [{ type: 'text', text: 'First' }],
          [{ type: 'text', text: 'Second' }],
        ],
      },
    ])
  })

  it('marks an unresolved token as unknown inside a paragraph', () => {
    const blocks = renderBoardMarkdown('We have {{metric:ghost.metric}} things.', {})
    expect(blocks[0]).toEqual({
      kind: 'paragraph',
      segments: [
        { type: 'text', text: 'We have ' },
        { type: 'unknown', slug: 'ghost.metric' },
        { type: 'text', text: ' things.' },
      ],
    })
  })

  it('returns no blocks for empty markdown', () => {
    expect(renderBoardMarkdown('', {})).toEqual([])
  })
})
