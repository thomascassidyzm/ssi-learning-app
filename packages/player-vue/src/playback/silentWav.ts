/**
 * Genuinely-silent, real-PCM WAV clips as `data:` URIs.
 *
 * The background/lock-screen playback protocol (see SimplePlayer's PAUSE
 * phase, dev 9666c7f): iOS Safari freezes JS timers on a backgrounded or
 * screen-locked tab, so ANY playback gap driven by a bare setTimeout dies
 * under lock. The audio element's 'ended' event still fires — so a gap
 * must be "a phase with audio": play a silent one-shot clip on the SAME
 * element the real clips use and advance on its natural 'ended'.
 *
 * The clip is synthesised at runtime as a data: URI — no bundled asset,
 * no fetch, no IndexedDB, no service worker — so it is silent AND works
 * fully offline by construction (a real WAV body, not an empty src iOS
 * treats as nothing). NEVER loop these clips (the looped-silence pattern
 * is the disabled 2026-05-23 oscillation landmine); strictly one-shot.
 */

/** Build a tiny, genuinely-silent 8-bit-mono WAV as a data: URI (all-128 =
 *  PCM zero for unsigned 8-bit → truly inaudible, real decodable media). */
export function buildSilentWavDataUri(seconds: number): string {
  const sampleRate = 8000 // low rate keeps the data URI small; silence has no spectrum to lose
  const numSamples = Math.round(sampleRate * seconds)
  const blockAlign = 1 // mono, 8-bit
  const dataLen = numSamples * blockAlign
  const buf = new Uint8Array(44 + dataLen)
  const view = new DataView(buf.buffer)
  const wr = (off: number, s: string) => { for (let i = 0; i < s.length; i++) buf[off + i] = s.charCodeAt(i) }
  wr(0, 'RIFF'); view.setUint32(4, 36 + dataLen, true); wr(8, 'WAVE')
  wr(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true)
  view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true); view.setUint16(32, blockAlign, true)
  view.setUint16(34, 8, true) // bits per sample
  wr(36, 'data'); view.setUint32(40, dataLen, true)
  buf.fill(128, 44) // unsigned-8-bit midpoint == silence
  let bin = ''
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i])
  const b64 = (typeof btoa === 'function') ? btoa(bin) : Buffer.from(buf).toString('base64')
  return `data:audio/wav;base64,${b64}`
}
