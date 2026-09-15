import { describe, it, expect } from 'vitest'
import { renderMarkdownLight } from './markdownLight'

describe('renderMarkdownLight', () => {
  it('splits paragraphs and lines, bolds **text**, links bare https urls, and never emits markup', () => {
    const out = renderMarkdownLight('Pod 1 is **live**.\nHave a listen: https://saysomethingin.app/me.\n\n<b>not html</b>')
    expect(out).toHaveLength(2)
    expect(out[0][0]).toEqual([{ text: 'Pod 1 is ' }, { text: 'live', bold: true }, { text: '.' }])
    expect(out[0][1]).toEqual([{ text: 'Have a listen: ' }, { text: 'https://saysomethingin.app/me', href: 'https://saysomethingin.app/me' }, { text: '.' }])
    expect(out[1][0]).toEqual([{ text: '<b>not html</b>' }])
  })
})
