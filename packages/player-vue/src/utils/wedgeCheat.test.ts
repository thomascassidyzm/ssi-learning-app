import { describe, it, expect } from 'vitest'
import { selectPrecacheEntriesToPoison } from './wedgeCheat'

describe('selectPrecacheEntriesToPoison', () => {
  it('prefers chunks referenced by the entry graph, preserving cache order', () => {
    const cached = ['/assets/vendor-vue-abc.js', '/assets/index-def.js', '/assets/admin-ghi.js']
    const entryGraph = ['/assets/index-def.js', '/assets/vendor-vue-abc.js']
    expect(selectPrecacheEntriesToPoison(cached, entryGraph)).toEqual([
      '/assets/vendor-vue-abc.js',
      '/assets/index-def.js',
    ])
  })

  it('excludes an entry-graph chunk once count is reached, never falling back over it', () => {
    const cached = ['/assets/vendor-vue-abc.js', '/assets/index-def.js', '/assets/admin-ghi.js']
    const entryGraph = ['/assets/index-def.js', '/assets/vendor-vue-abc.js', '/assets/admin-ghi.js']
    expect(selectPrecacheEntriesToPoison(cached, entryGraph, 2)).toEqual([
      '/assets/vendor-vue-abc.js',
      '/assets/index-def.js',
    ])
  })

  it('falls back to non-entry-graph js when the entry graph has too few', () => {
    const cached = ['/assets/index-def.js', '/assets/admin-ghi.js']
    const entryGraph = ['/assets/index-def.js']
    expect(selectPrecacheEntriesToPoison(cached, entryGraph)).toEqual([
      '/assets/index-def.js',
      '/assets/admin-ghi.js',
    ])
  })

  it('ignores non-js cache entries', () => {
    const cached = ['/assets/style-abc.css', '/index.html', '/assets/index-def.js']
    expect(selectPrecacheEntriesToPoison(cached, [])).toEqual(['/assets/index-def.js'])
  })

  it('caps at the requested count', () => {
    const cached = ['/a.js', '/b.js', '/c.js', '/d.js']
    expect(selectPrecacheEntriesToPoison(cached, [], 2)).toEqual(['/a.js', '/b.js'])
  })

  it('returns fewer than count when not enough js entries exist', () => {
    expect(selectPrecacheEntriesToPoison(['/only.js'], [])).toEqual(['/only.js'])
  })
})
