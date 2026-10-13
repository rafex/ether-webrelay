import { describe, expect, it } from 'vitest';
import { ProtocolError } from '../../src/domain/errors';
import {
  base64ToBytes,
  bytesToBase64,
  decodeFrame,
  decodeJsonPayload,
  encodeFrame,
  encodeJsonPayload,
  FRAME_MAGIC,
  FrameFlag,
  FrameType,
  HEADER_SIZE,
  nextSequence,
  parseBridgeMessage,
  TrackId,
} from '../../src/domain/protocol';

const sample = {
  type: FrameType.Media,
  track: TrackId.Video,
  flags: FrameFlag.Keyframe | FrameFlag.Discontinuity,
  sequence: 42,
  timestampUs: 3_600_000_123_456, // one hour+ — must not overflow 32 bits
  durationUs: 33_333,
  payload: new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
};

describe('frame codec', () => {
  it('round-trips every header field and the payload', () => {
    const decoded = decodeFrame(encodeFrame(sample));
    expect(decoded).toEqual(sample);
  });

  it('lays out the header big-endian at fixed offsets', () => {
    const view = new DataView(encodeFrame(sample));
    expect(view.byteLength).toBe(HEADER_SIZE + 4);
    expect(view.getUint16(0)).toBe(FRAME_MAGIC);
    expect(view.getUint8(2)).toBe(1);
    expect(view.getUint8(3)).toBe(0x10);
    expect(view.getUint8(4)).toBe(1);
    expect(view.getUint8(5)).toBe(0b11);
    expect(view.getUint32(8)).toBe(42);
    expect(view.getBigInt64(12)).toBe(3_600_000_123_456n);
    expect(view.getUint32(24)).toBe(4);
  });

  it('decodes from a view into a larger buffer', () => {
    const encoded = new Uint8Array(encodeFrame(sample));
    const padded = new Uint8Array(encoded.length + 10);
    padded.set(encoded, 5);
    expect(decodeFrame(padded.subarray(5, 5 + encoded.length))).toEqual(sample);
  });

  it.each([
    ['short buffer', new Uint8Array(10)],
    ['bad magic', mutate(0, 0x00)],
    ['bad version', mutate(2, 9)],
    ['unknown type', mutate(3, 0x7f)],
    ['unknown track', mutate(4, 9)],
    ['size mismatch', mutate(27, 99)],
  ])('rejects %s', (_label, bytes) => {
    expect(() => decodeFrame(bytes)).toThrow(ProtocolError);
  });

  it('rejects out-of-range header values when encoding', () => {
    expect(() => encodeFrame({ ...sample, sequence: -1 })).toThrow(ProtocolError);
    expect(() => encodeFrame({ ...sample, sequence: 2 ** 32 })).toThrow(ProtocolError);
    expect(() => encodeFrame({ ...sample, timestampUs: -5 })).toThrow(ProtocolError);
    expect(() => encodeFrame({ ...sample, durationUs: 1.5 })).toThrow(ProtocolError);
  });

  it('wraps sequence numbers at 2^32', () => {
    expect(nextSequence(7)).toBe(8);
    expect(nextSequence(0xffff_ffff)).toBe(0);
  });
});

describe('JSON payloads', () => {
  it('round-trips', () => {
    expect(decodeJsonPayload(encodeJsonPayload({ a: 1, b: 'ñ' }))).toEqual({ a: 1, b: 'ñ' });
  });

  it('wraps parse failures in ProtocolError', () => {
    expect(() => decodeJsonPayload(new Uint8Array([0x7b]))).toThrow(ProtocolError);
  });
});

describe('bridge messages', () => {
  it('parses each known message type', () => {
    expect(parseBridgeMessage('{"type":"welcome","streamId":"s1","resumed":true}')).toEqual({
      type: 'welcome',
      streamId: 's1',
      resumed: true,
    });
    expect(parseBridgeMessage('{"type":"keyframe-request"}')).toEqual({ type: 'keyframe-request' });
    expect(parseBridgeMessage('{"type":"pong","timestampUs":5}')).toEqual({
      type: 'pong',
      timestampUs: 5,
    });
    expect(parseBridgeMessage('{"type":"ack","sequence":3}')).toEqual({ type: 'ack', sequence: 3 });
    expect(parseBridgeMessage('{"type":"status","state":"publishing","detail":"ok"}')).toEqual({
      type: 'status',
      state: 'publishing',
      detail: 'ok',
    });
    expect(
      parseBridgeMessage('{"type":"error","code":"auth","message":"no","fatal":true}'),
    ).toEqual({ type: 'error', code: 'auth', message: 'no', fatal: true });
  });

  it.each([
    'not json',
    '42',
    '{"type":"welcome"}',
    '{"type":"status","state":"dancing"}',
    '{"type":"mystery"}',
  ])('rejects %s', (text) => {
    expect(() => parseBridgeMessage(text)).toThrow(ProtocolError);
  });
});

describe('base64', () => {
  it('round-trips binary data larger than one chunk', () => {
    const bytes = new Uint8Array(70_000).map((_, i) => i % 256);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });
});

function mutate(offset: number, value: number): Uint8Array {
  const bytes = new Uint8Array(encodeFrame(sample));
  bytes[offset] = value;
  return bytes;
}
