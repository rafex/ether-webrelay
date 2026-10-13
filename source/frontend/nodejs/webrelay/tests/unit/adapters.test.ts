import { describe, expect, it } from 'vitest';
import { EMPTY_STATS, summarizeStats } from '../../src/domain/call-stats';
import { RelayError } from '../../src/domain/errors';
import { DEFAULT_PREFERENCES } from '../../src/domain/preferences';
import { toCaptureError } from '../../src/infrastructure/devices/browser-media-devices';
import {
  LocalPreferences,
  PREFERENCES_KEY,
} from '../../src/infrastructure/storage/local-preferences';

const records = (bytesSent: number, bytesReceived: number) => [
  {
    id: 'o1',
    type: 'outbound-rtp',
    kind: 'video',
    bytesSent,
    frameWidth: 1280,
    frameHeight: 720,
    framesPerSecond: 30,
    codecId: 'c1',
  },
  { id: 'o2', type: 'outbound-rtp', kind: 'audio', bytesSent: 1000 },
  {
    id: 'i1',
    type: 'inbound-rtp',
    kind: 'video',
    bytesReceived,
    packetsReceived: 990,
    packetsLost: 10,
  },
  { id: 'c1', type: 'codec', mimeType: 'video/VP8' },
  {
    id: 'p1',
    type: 'candidate-pair',
    state: 'succeeded',
    nominated: true,
    currentRoundTripTime: 0.042,
    localCandidateId: 'l1',
  },
  { id: 'p2', type: 'candidate-pair', state: 'failed', currentRoundTripTime: 9 },
  { id: 'l1', type: 'local-candidate', candidateType: 'relay' },
];

describe('summarizeStats', () => {
  it('extracts RTT, loss, resolution, codec and candidate type', () => {
    expect(summarizeStats(records(100_000, 50_000), 1_000)).toEqual({
      atMs: 1_000,
      bytesSent: 101_000,
      bytesReceived: 50_000,
      uploadBps: 0,
      downloadBps: 0,
      rttMs: 42,
      packetLossPercent: 1,
      sendFps: 30,
      sendResolution: '1280x720',
      videoCodec: 'VP8',
      candidateType: 'relay',
    });
  });

  it('computes rates from the previous sample', () => {
    const first = summarizeStats(records(100_000, 50_000), 1_000);
    const second = summarizeStats(records(350_000, 175_000), 3_000, first);
    expect(second.uploadBps).toBe(1_000_000); // 250 KB in 2 s
    expect(second.downloadBps).toBe(500_000);
  });

  it('copes with empty reports and counter resets', () => {
    expect(summarizeStats([], 5)).toEqual({ ...EMPTY_STATS, atMs: 5 });
    const first = summarizeStats(records(500_000, 0), 1_000);
    expect(summarizeStats(records(10, 0), 2_000, first).uploadBps).toBe(0);
  });
});

describe('LocalPreferences', () => {
  const memory = () => {
    const data = new Map<string, string>();
    return {
      data,
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
    };
  };

  it('round-trips preferences through storage', () => {
    const storage = memory();
    const prefs = new LocalPreferences(storage);
    expect(prefs.load()).toEqual(DEFAULT_PREFERENCES);
    prefs.save({ ...DEFAULT_PREFERENCES, name: 'Ana', view: 'stats' });
    expect(JSON.parse(storage.data.get(PREFERENCES_KEY) ?? '{}')).toMatchObject({ name: 'Ana' });
    expect(new LocalPreferences(storage).load()).toMatchObject({ name: 'Ana', view: 'stats' });
  });

  it('survives missing, corrupt or throwing storage', () => {
    expect(new LocalPreferences(undefined).load()).toEqual(DEFAULT_PREFERENCES);
    const corrupt = memory();
    corrupt.data.set(PREFERENCES_KEY, '{not json');
    expect(new LocalPreferences(corrupt).load()).toEqual(DEFAULT_PREFERENCES);
    const throwing = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    const prefs = new LocalPreferences(throwing);
    expect(prefs.load()).toEqual(DEFAULT_PREFERENCES);
    expect(() => prefs.save(DEFAULT_PREFERENCES)).not.toThrow();
  });
});

describe('toCaptureError', () => {
  it.each([
    ['NotAllowedError', 'camera', 'Se denegó el permiso para usar la cámara.'],
    ['NotFoundError', 'microphone', 'No se encontró el micrófono o no admite esta configuración.'],
    ['NotReadableError', 'camera', 'La cámara está en uso por otra aplicación.'],
  ] as const)('maps %s for %s', (name, source, message) => {
    const error = toCaptureError(Object.assign(new Error('x'), { name }), source);
    expect(error).toBeInstanceOf(RelayError);
    expect(error.code).toBe('capture-denied');
    expect(error.message).toBe(message);
  });

  it('passes RelayErrors through and describes unknown failures', () => {
    const relay = new RelayError('no-sources', 'nada');
    expect(toCaptureError(relay)).toBe(relay);
    expect(toCaptureError(new Error('boom'), 'screen').message).toBe(
      'Falló el acceso a la pantalla: boom',
    );
  });
});
