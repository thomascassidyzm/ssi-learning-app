// Positive evidence, not absence of an exception. This is deliberately separate
// from the browser driver so failure cases need no live accounts or browser.
export function firstBeltVerdict(e) {
  if (e.pageErrors?.length) return { verdict: 'fail', note: 'Uncaught exception during the step' }
  const required = [
    [e.fixtureReset === true, 'blank fixture reset'],
    [/White Belt/i.test(e.before || ''), 'initial White Belt'],
    [e.audio?.firstLessonAudible > 0 && !!e.audio?.firstLessonSrc &&
      !/welcome|brand|placeholder|silent|keepalive|data:audio/i.test(e.audio.firstLessonSrc), 'lesson media-clock advancement'],
    // The shared journeys detector does NOT provide this measurement. Silent
    // PCM advances its clock too. Missing sample evidence must block the probe.
    [e.audio?.nonzeroFrames > 0, 'non-silent decoded lesson samples (not implemented in the shared detector)'],
    [e.startPaint?.kind === 'structural' || e.startPaint?.kind === 'structural-removal', 'painted player start'],
    [/(?:^|\s)belt-yellow(?:\s|$)/.test(e.transition?.className || ''), 'visible yellow player'],
    [e.transitionScreenshot === true, 'transition screenshot'],
    [e.deployment?.buildNumber && e.afterBuild === e.deployment.buildNumber &&
      e.runtimeBuilds?.length === 1 && e.runtimeBuilds[0] === e.deployment.buildNumber, 'stable running build identity'],
  ]
  const missing = required.filter(([ok]) => !ok).map(([, label]) => label)
  return missing.length
    ? { verdict: 'not checked', note: `Missing evidence: ${missing.join(', ')}` }
    : { verdict: 'pass', note: 'Natural White-to-Yellow playback transition captured with non-silent sample evidence; not physical speaker certification' }
}
