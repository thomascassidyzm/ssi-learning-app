import { test } from 'node:test'
import assert from 'node:assert/strict'
import { firstBeltVerdict } from './release-evidence.mjs'

const complete = () => ({
  fixtureReset: true, before: 'Spanish\nWhite Belt',
  audio: { firstPlayCall: 1, firstLessonAudible: 500, firstLessonSrc: 'https://example.invalid/lesson.mp3', nonzeroFrames: 100 },
  startPaint: { kind: 'structural', paintedMs: 50 },
  transition: { className: 'player belt-yellow' }, transitionScreenshot: true,
  deployment: { buildNumber: 'abcdef0' }, afterBuild: 'abcdef0', runtimeBuilds: ['abcdef0'], pageErrors: [],
})

test('play promises, brand chimes, missing screenshots and drift cannot release step 1', () => {
  assert.equal(firstBeltVerdict(complete()).verdict, 'pass')
  for (const patch of [
    { audio: { firstPlayCall: 1 } },
    { audio: { firstPlayCall: 1, firstLessonAudible: 547, firstLessonSrc: 'blob:https://release-probe.invalid/clip', nonzeroFrames: 0 } },
    { audio: { firstLessonAudible: 500, firstLessonSrc: 'https://example.invalid/brand.mp3' } },
    { fixtureReset: false }, { before: 'Yellow Belt' },
    { startPaint: { kind: 'timeout' } }, { transitionScreenshot: false },
    { transition: { className: 'player belt-white' } },
    { afterBuild: '1234567' }, { runtimeBuilds: [] }, { runtimeBuilds: ['abcdef0', '1234567'] },
  ]) assert.equal(firstBeltVerdict({ ...complete(), ...patch }).verdict, 'not checked', JSON.stringify(patch))
  assert.equal(firstBeltVerdict({ ...complete(), pageErrors: ['boom'] }).verdict, 'fail')
  assert.equal(firstBeltVerdict({}).verdict, 'not checked')
})
