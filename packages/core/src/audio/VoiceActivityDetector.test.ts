import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VoiceActivityDetector, createVoiceActivityDetector } from './VoiceActivityDetector';
import type { VADConfig } from './types';

// Mock Web Audio API
const createMockAnalyserNode = () => ({
  fftSize: 2048,
  frequencyBinCount: 1024,
  smoothingTimeConstant: 0.8,
  getByteFrequencyData: vi.fn((arr: Uint8Array) => arr.fill(0)),
  connect: vi.fn(),
  disconnect: vi.fn(),
});

const createMockSourceNode = () => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
});

const createMockMediaStreamTrack = () => ({
  stop: vi.fn(),
});

const createMockMediaStream = (track = createMockMediaStreamTrack()) => ({
  getTracks: vi.fn(() => [track]),
});

const createMockAudioContext = (analyser = createMockAnalyserNode(), source = createMockSourceNode()) => ({
  createAnalyser: vi.fn(() => analyser),
  createMediaStreamSource: vi.fn(() => source),
  state: 'running' as AudioContextState,
  resume: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
});

describe('VoiceActivityDetector', () => {
  let mockAnalyser: ReturnType<typeof createMockAnalyserNode>;
  let mockSource: ReturnType<typeof createMockSourceNode>;
  let mockTrack: ReturnType<typeof createMockMediaStreamTrack>;
  let mockStream: ReturnType<typeof createMockMediaStream>;
  let mockAudioContext: ReturnType<typeof createMockAudioContext>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create fresh mocks
    mockAnalyser = createMockAnalyserNode();
    mockSource = createMockSourceNode();
    mockTrack = createMockMediaStreamTrack();
    mockStream = createMockMediaStream(mockTrack);
    mockAudioContext = createMockAudioContext(mockAnalyser, mockSource);

    // Stub globals
    vi.stubGlobal('window', {
      AudioContext: vi.fn(() => mockAudioContext),
    });

    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi.fn().mockResolvedValue(mockStream),
      },
    });

    vi.stubGlobal('requestAnimationFrame', vi.fn((cb) => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal('performance', { now: vi.fn(() => Date.now()) });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('construction', () => {
    it('should create with default config', () => {
      const vad = new VoiceActivityDetector();
      expect(vad).toBeDefined();
      expect(vad.isInitialized()).toBe(false);
    });

    it('should create with custom config', () => {
      const config: Partial<VADConfig> = {
        energy_threshold_db: -50,
        min_frames_above: 5,
      };
      const vad = new VoiceActivityDetector(config);
      expect(vad).toBeDefined();
    });

    it('should create via factory function', () => {
      const vad = createVoiceActivityDetector({ energy_threshold_db: -40 });
      expect(vad).toBeDefined();
    });
  });

  describe('initialization', () => {
    it('should initialize successfully with microphone access', async () => {
      const vad = new VoiceActivityDetector();
      const result = await vad.initialize();

      expect(result).toBe(true);
      expect(vad.isInitialized()).toBe(true);
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
    });

    it('should return false if getUserMedia fails', async () => {
      vi.stubGlobal('navigator', {
        mediaDevices: {
          getUserMedia: vi.fn().mockRejectedValue(new Error('Permission denied')),
        },
      });

      const vad = new VoiceActivityDetector();
      const result = await vad.initialize();

      expect(result).toBe(false);
      expect(vad.isInitialized()).toBe(false);
    });

    it('should return false if getUserMedia not supported', async () => {
      vi.stubGlobal('navigator', {
        mediaDevices: undefined,
      });

      const vad = new VoiceActivityDetector();
      const result = await vad.initialize();

      expect(result).toBe(false);
    });

    it('should return false if not in browser environment', async () => {
      vi.stubGlobal('window', undefined);

      const vad = new VoiceActivityDetector();
      const result = await vad.initialize();

      expect(result).toBe(false);
    });
  });

  describe('monitoring', () => {
    it('should not start monitoring if not initialized', () => {
      const vad = new VoiceActivityDetector();
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      vad.startMonitoring();

      expect(consoleSpy).toHaveBeenCalledWith(
        'VoiceActivityDetector: Not initialized, call initialize() first'
      );
      consoleSpy.mockRestore();
    });

    it('should start and stop monitoring', async () => {
      const vad = new VoiceActivityDetector();
      await vad.initialize();

      vad.startMonitoring();
      expect(requestAnimationFrame).toHaveBeenCalled();

      const result = vad.stopMonitoring();

      expect(result).toBeDefined();
      expect(result.start_time).toBeDefined();
      expect(result.end_time).toBeDefined();
      expect(cancelAnimationFrame).toHaveBeenCalled();
    });

    it('should return VADResult with no speech when silent', async () => {
      const vad = new VoiceActivityDetector();
      await vad.initialize();

      vad.startMonitoring();
      const result = vad.stopMonitoring();

      expect(result.speech_detected).toBe(false);
      expect(result.speech_duration_ms).toBe(0);
      expect(result.activity_ratio).toBe(0);
    });
  });

  describe('getStatus', () => {
    it('should return inactive status when not monitoring', () => {
      const vad = new VoiceActivityDetector();
      const status = vad.getStatus();

      expect(status.is_active).toBe(false);
      expect(status.is_speaking).toBe(false);
      expect(status.current_energy_db).toBe(-100);
    });

    it('should return active status when monitoring', async () => {
      mockAnalyser.getByteFrequencyData.mockImplementation((arr: Uint8Array) => {
        arr.fill(100);
      });

      const vad = new VoiceActivityDetector();
      await vad.initialize();
      vad.startMonitoring();

      const status = vad.getStatus();

      expect(status.is_active).toBe(true);
      expect(status.current_energy_db).toBeDefined();
    });
  });

  describe('getCurrentEnergy', () => {
    it('should return -100 when not initialized', () => {
      const vad = new VoiceActivityDetector();
      expect(vad.getCurrentEnergy()).toBe(-100);
    });

    it('should calculate RMS energy from frequency data', async () => {
      mockAnalyser.getByteFrequencyData.mockImplementation((arr: Uint8Array) => {
        // Half-amplitude signal (128 out of 255)
        arr.fill(128);
      });

      const vad = new VoiceActivityDetector();
      await vad.initialize();

      const energy = vad.getCurrentEnergy();

      // For normalized value of 0.5 (~128/255), RMS should be ~0.5
      // dB = 20 * log10(0.5) ≈ -6 dB
      expect(energy).toBeGreaterThan(-10);
      expect(energy).toBeLessThan(0);
    });

    it('should return -100 for silent signal', async () => {
      mockAnalyser.getByteFrequencyData.mockImplementation((arr: Uint8Array) => {
        arr.fill(0);
      });

      const vad = new VoiceActivityDetector();
      await vad.initialize();

      const energy = vad.getCurrentEnergy();
      expect(energy).toBe(-100);
    });
  });

  describe('updateConfig', () => {
    it('should update config values', async () => {
      const vad = new VoiceActivityDetector();
      await vad.initialize();

      vad.updateConfig({
        energy_threshold_db: -60,
        fft_size: 4096,
        smoothing: 0.9,
      });

      expect(mockAnalyser.fftSize).toBe(4096);
      expect(mockAnalyser.smoothingTimeConstant).toBe(0.9);
    });
  });

  describe('dispose', () => {
    it('should clean up all resources', async () => {
      const vad = new VoiceActivityDetector();
      await vad.initialize();
      vad.startMonitoring();

      vad.dispose();

      expect(vad.isInitialized()).toBe(false);
      expect(mockSource.disconnect).toHaveBeenCalled();
      expect(mockAnalyser.disconnect).toHaveBeenCalled();
      expect(mockAudioContext.close).toHaveBeenCalled();
      expect(mockTrack.stop).toHaveBeenCalled();
    });

    it('should handle dispose when not initialized', () => {
      const vad = new VoiceActivityDetector();
      expect(() => vad.dispose()).not.toThrow();
    });
  });

  describe('resume audio context', () => {
    it('should resume suspended audio context when starting monitoring', async () => {
      mockAudioContext.state = 'suspended';

      const vad = new VoiceActivityDetector();
      await vad.initialize();
      vad.startMonitoring();

      expect(mockAudioContext.resume).toHaveBeenCalled();
    });
  });
});
