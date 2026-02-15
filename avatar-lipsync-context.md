## Avatar Lip-Sync Feature — Context & Direction

### What we're building
Real-time animated avatar with lip sync driven by audio playback during the SSi learning cycle. The avatar's mouth movements are synchronised to pre-recorded audio clips (1-3 seconds each) that play during the 4-phase learning cycle: PROMPT → PAUSE → VOICE_1 → VOICE_2.

### Why it's feasible now
Browser-native solutions now exist that connect a Web Audio API `AnalyserNode` to an `HTMLAudioElement`, run real-time frequency analysis, and output viseme/mouth-shape data — no server-side rendering or pre-processing needed.

### Architecture fit
- **Single reused `<audio>` element** — the AnalyserNode connects to this once and passively monitors all subsequent playback
- **Short audio clips with built-in pauses** — no drift accumulation, pauses give natural idle animation time
- **Phase events drive avatar state:**
  - `PROMPT` → avatar speaks (known language audio playing)
  - `PAUSE` → avatar idle/waiting/encouraging (silence, learner speaks)
  - `VOICE_1` → avatar speaks (target language, voice A, no target text shown)
  - `VOICE_2` → avatar speaks (target language, voice B, target text reveals)
  - `cycle:complete` → avatar idle/transition

### Recommended approach
Start with **2D stylised avatar** (SVG/Canvas), not photorealistic 3D. Reasons:
- Stylised avoids uncanny valley — the brain fills in gaps
- Lighter on mobile GPU
- Faster to iterate on quality
- Matches a "tutor character" aesthetic

If 2D proves the concept, graduate to 3D (React Three Fiber + GLB avatars) later.

### Key libraries to evaluate
1. **[lipsync-engine](https://github.com/Amoner/lipsync-engine)** — zero-dependency, renderer-agnostic. Emits `{open, width, round, intensity}` shape params from audio frequency bands. Simplest integration.
2. **[wawa-lipsync](https://github.com/wass08/wawa-lipsync)** — TypeScript, connects directly to HTML `<audio>` element via `connectAudio()`, call `processAudio()` in rAF loop to get current viseme. Built for React Three Fiber.
3. **[TalkingHead](https://github.com/met4citizen/TalkingHead)** — full 3D system with Three.js, GLB avatars, Mixamo animations. Heaviest but most complete.

### Technical integration pattern (React)
```tsx
// 1. Connect AnalyserNode to existing audio element
const audioContext = new AudioContext()
const source = audioContext.createMediaElementSource(audioElement)
const analyser = audioContext.createAnalyser()
source.connect(analyser)
analyser.connect(audioContext.destination)

// 2. In animation loop, read frequency data
function animate() {
  const data = new Uint8Array(analyser.frequencyBinCount)
  analyser.getByteFrequencyData(data)
  // Map frequency bands → mouth shape params
  // Drive avatar renderer
  requestAnimationFrame(animate)
}

// 3. Avatar state follows phase events
// PROMPT/VOICE_1/VOICE_2 → lip sync active
// PAUSE → idle animation
// cycle:complete → transition
```

### Quality considerations
- Vowels map well from frequency analysis; consonants less so (but stylised avatars are forgiving)
- Language-agnostic — reads audio signal, not phonemes — works for Welsh, Spanish, Italian etc.
- Mobile performance needs testing if adding Three.js alongside existing UI
- **The screen is theatre for the sale. The ears do the work.** — the avatar should enhance, not distract

### Decision to make first
2D (SVG/Canvas with lipsync-engine) vs 3D (React Three Fiber with wawa-lipsync or TalkingHead). Recommend starting 2D to validate quality quickly.

### SSi Learning App audio architecture (for reference)
- Audio files are atomic (1-3s each), fetched from `/api/audio/{audioId}` backend proxy
- Single reused HTMLAudioElement (critical for mobile Safari unlock)
- Cycle objects are immutable — audio IDs pre-bound, no text lookup
- CyclePlayer emits phase events: `phase:prompt`, `phase:pause`, `phase:voice1`, `phase:voice2`, `cycle:complete`
- IndexedDB + Service Worker caching for offline play
- Dynamic pause duration (default 2x target audio length)
