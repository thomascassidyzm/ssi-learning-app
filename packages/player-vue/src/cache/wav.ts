/**
 * wav.ts — decode compressed audio bytes (mp3) and re-encode as a 16-bit
 * WAV blob, for OFFLINE playback only.
 *
 * Why: WebKit (desktop Safari AND iOS) refuses to play an <audio> element
 * whose src is a blob: URL backed by mp3 bytes from IndexedDB — it aborts
 * with "operation is not supported". But it plays WAV blobs fine; the old
 * driving-mode concatenation path proved this (it decoded everything to a
 * single 16-bit WAV blob). This is that same decode + encode, applied per
 * clip, so the existing <audio> player can play cached audio offline.
 *
 * Online streaming is untouched — it still hands the proxy /api/audio URL to
 * the audio element. This conversion runs only on the offline resolve path.
 *
 * Lifted from the deleted utils/audioConcatenator.ts (commit 59a17a7b^),
 * minus the concatenation/normalisation we don't need per clip.
 */

const BITS_PER_SAMPLE = 16

let sharedCtx: AudioContext | null = null

function getCtx(): AudioContext | null {
  if (sharedCtx) return sharedCtx
  const Ctx = (typeof window !== 'undefined')
    ? ((window as any).AudioContext || (window as any).webkitAudioContext)
    : null
  if (!Ctx) return null
  try {
    sharedCtx = new Ctx() as AudioContext
  } catch {
    return null
  }
  return sharedCtx
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i))
  }
}

/** Encode an AudioBuffer to a 16-bit PCM WAV blob (audio/wav). */
function encodeWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels
  const sampleRate = buffer.sampleRate
  const bytesPerSample = BITS_PER_SAMPLE / 8
  const blockAlign = numChannels * bytesPerSample
  const byteRate = sampleRate * blockAlign
  const numSamples = buffer.length
  const dataSize = numSamples * blockAlign
  const headerSize = 44

  const arrayBuffer = new ArrayBuffer(headerSize + dataSize)
  const view = new DataView(arrayBuffer)

  writeString(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeString(view, 8, 'WAVE')
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true)              // PCM fmt chunk size
  view.setUint16(20, 1, true)               // AudioFormat = PCM
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, BITS_PER_SAMPLE, true)
  writeString(view, 36, 'data')
  view.setUint32(40, dataSize, true)

  const channelData: Float32Array[] = []
  for (let ch = 0; ch < numChannels; ch++) channelData.push(buffer.getChannelData(ch))

  let byteOffset = headerSize
  for (let i = 0; i < numSamples; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channelData[ch][i]))
      view.setInt16(byteOffset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
      byteOffset += 2
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' })
}

/**
 * Decode mp3 (or any decodeAudioData-supported) bytes → 16-bit WAV blob.
 * Returns null if there's no AudioContext or decode fails (caller falls
 * back to the network URL).
 */
export async function bytesToWavBlob(data: ArrayBuffer): Promise<Blob | null> {
  const ctx = getCtx()
  if (!ctx) return null
  try {
    // decodeAudioData may detach the buffer — hand it a copy.
    const buffer = await ctx.decodeAudioData(data.slice(0))
    return encodeWav(buffer)
  } catch (err) {
    console.warn('[wav] decode failed:', err)
    return null
  }
}
