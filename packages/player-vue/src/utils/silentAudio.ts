/**
 * Silent Audio Generator for iOS Audio Session Keep-Alive
 *
 * Generates a 1-second silent WAV audio blob using Web Audio API.
 * This is used to keep the iOS audio session alive between rounds
 * (the "silent audio placeholder" trick for Driving Mode).
 *
 * No need to ship a static file - creates the WAV on demand and caches it.
 */

let cachedSilentBlobUrl: string | null = null

/**
 * Get a URL to a 1-second silent audio file.
 * The blob URL is cached so subsequent calls return the same URL.
 *
 * @returns A blob URL pointing to a silent WAV audio file
 */
export function getSilentAudioUrl(): string {
  if (cachedSilentBlobUrl) return cachedSilentBlobUrl

  // Audio parameters: 44100 Hz, 16-bit, mono
  const sampleRate = 44100
  const duration = 1 // seconds
  const numSamples = sampleRate * duration
  const bitsPerSample = 16
  const numChannels = 1
  const bytesPerSample = bitsPerSample / 8
  const blockAlign = numChannels * bytesPerSample
  const byteRate = sampleRate * blockAlign
  const dataSize = numSamples * blockAlign
  const headerSize = 44

  // Create WAV file in memory
  const buffer = new ArrayBuffer(headerSize + dataSize)
  const view = new DataView(buffer)

  // RIFF chunk descriptor
  writeString(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true) // File size - 8 bytes
  writeString(view, 8, 'WAVE')

  // fmt sub-chunk
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true) // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true) // AudioFormat (1 = PCM)
  view.setUint16(22, numChannels, true) // NumChannels
  view.setUint32(24, sampleRate, true) // SampleRate
  view.setUint32(28, byteRate, true) // ByteRate
  view.setUint16(32, blockAlign, true) // BlockAlign
  view.setUint16(34, bitsPerSample, true) // BitsPerSample

  // data sub-chunk
  writeString(view, 36, 'data')
  view.setUint32(40, dataSize, true) // Subchunk2Size

  // Audio data - all zeros = silence
  // ArrayBuffer is zero-initialized by default, so no need to write samples

  const blob = new Blob([buffer], { type: 'audio/wav' })
  cachedSilentBlobUrl = URL.createObjectURL(blob)

  return cachedSilentBlobUrl
}

/**
 * Write an ASCII string to a DataView at the specified offset.
 */
function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i))
  }
}
