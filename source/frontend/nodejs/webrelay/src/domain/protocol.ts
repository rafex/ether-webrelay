/**
 * Ether WebRelay wire protocol, version 1.
 *
 * Client → bridge traffic is binary WebSocket messages, one frame per message:
 *
 * | offset | size | field        | notes                                         |
 * |--------|------|--------------|-----------------------------------------------|
 * | 0      | 2    | magic        | 0x4557 ("EW")                                 |
 * | 2      | 1    | version      | 1                                             |
 * | 3      | 1    | type         | {@link FrameType}                             |
 * | 4      | 1    | track        | {@link TrackId}                               |
 * | 5      | 1    | flags        | {@link FrameFlag} bitmask                     |
 * | 6      | 2    | reserved     | 0                                             |
 * | 8      | 4    | sequence     | u32, monotonic per stream, survives reconnect |
 * | 12     | 8    | timestamp µs | i64, presentation time on the session clock   |
 * | 20     | 4    | duration µs  | u32                                           |
 * | 24     | 4    | payload size | u32                                           |
 * | 28     | n    | payload      | codec bytes, or UTF-8 JSON for control frames |
 *
 * All integers are big-endian. Bridge → client traffic is UTF-8 JSON text
 * messages, see {@link BridgeMessage}. Full contract: docs/protocol.md.
 */
import { ProtocolError } from './errors';

export const PROTOCOL_NAME = 'ether-webrelay';
export const PROTOCOL_VERSION = 1;
export const FRAME_MAGIC = 0x4557;
export const HEADER_SIZE = 28;
export const MAX_PAYLOAD_SIZE = 16 * 1024 * 1024;

export const FrameType = {
  Hello: 0x01,
  Config: 0x02,
  Media: 0x10,
  Ping: 0x20,
  Bye: 0x30,
} as const;
export type FrameType = (typeof FrameType)[keyof typeof FrameType];

export const TrackId = {
  Control: 0,
  Video: 1,
  Audio: 2,
} as const;
export type TrackId = (typeof TrackId)[keyof typeof TrackId];

export const FrameFlag = {
  None: 0,
  Keyframe: 1 << 0,
  /** First media frame of a track after a (re)connection: the bridge must reset its decoder state. */
  Discontinuity: 1 << 1,
} as const;

export interface Frame {
  readonly type: FrameType;
  readonly track: TrackId;
  readonly flags: number;
  readonly sequence: number;
  readonly timestampUs: number;
  readonly durationUs: number;
  readonly payload: Uint8Array;
}

const FRAME_TYPES = new Set<number>(Object.values(FrameType));
const TRACK_IDS = new Set<number>(Object.values(TrackId));
const U32_MAX = 0xffff_ffff;

export function encodeFrame(frame: Frame): ArrayBuffer {
  assertU32('sequence', frame.sequence);
  assertU32('duration', frame.durationUs);
  if (!Number.isSafeInteger(frame.timestampUs) || frame.timestampUs < 0) {
    throw new ProtocolError(`timestamp must be a non-negative safe integer: ${frame.timestampUs}`);
  }
  if (frame.payload.byteLength > MAX_PAYLOAD_SIZE) {
    throw new ProtocolError(`payload exceeds ${MAX_PAYLOAD_SIZE} bytes`);
  }

  const buffer = new ArrayBuffer(HEADER_SIZE + frame.payload.byteLength);
  const view = new DataView(buffer);
  view.setUint16(0, FRAME_MAGIC);
  view.setUint8(2, PROTOCOL_VERSION);
  view.setUint8(3, frame.type);
  view.setUint8(4, frame.track);
  view.setUint8(5, frame.flags & 0xff);
  view.setUint16(6, 0);
  view.setUint32(8, frame.sequence);
  view.setBigInt64(12, BigInt(frame.timestampUs));
  view.setUint32(20, frame.durationUs);
  view.setUint32(24, frame.payload.byteLength);
  new Uint8Array(buffer, HEADER_SIZE).set(frame.payload);
  return buffer;
}

export function decodeFrame(data: ArrayBuffer | ArrayBufferView): Frame {
  const bytes =
    data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (bytes.byteLength < HEADER_SIZE) {
    throw new ProtocolError(`frame shorter than header: ${bytes.byteLength} bytes`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint16(0) !== FRAME_MAGIC) throw new ProtocolError('bad magic');
  const version = view.getUint8(2);
  if (version !== PROTOCOL_VERSION) throw new ProtocolError(`unsupported version ${version}`);
  const type = view.getUint8(3);
  if (!FRAME_TYPES.has(type)) throw new ProtocolError(`unknown frame type 0x${type.toString(16)}`);
  const track = view.getUint8(4);
  if (!TRACK_IDS.has(track)) throw new ProtocolError(`unknown track ${track}`);
  const size = view.getUint32(24);
  if (size !== bytes.byteLength - HEADER_SIZE) {
    throw new ProtocolError(
      `payload size mismatch: header=${size} actual=${bytes.byteLength - HEADER_SIZE}`,
    );
  }
  return {
    type: type as FrameType,
    track: track as TrackId,
    flags: view.getUint8(5),
    sequence: view.getUint32(8),
    timestampUs: Number(view.getBigInt64(12)),
    durationUs: view.getUint32(20),
    payload: bytes.slice(HEADER_SIZE),
  };
}

/** Sequence numbers wrap at 2^32. */
export function nextSequence(sequence: number): number {
  return sequence >= U32_MAX ? 0 : sequence + 1;
}

function assertU32(field: string, value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > U32_MAX) {
    throw new ProtocolError(`${field} out of u32 range: ${value}`);
  }
}

// ---------------------------------------------------------------------------
// Control payloads (JSON inside binary frames)
// ---------------------------------------------------------------------------

export interface HelloPayload {
  readonly protocol: typeof PROTOCOL_NAME;
  readonly version: typeof PROTOCOL_VERSION;
  /** Stable for the life of a broadcast; reused on every reconnection. */
  readonly streamId: string;
  /** True when this connection continues a stream the bridge may still hold open. */
  readonly resume: boolean;
  /** Invitation room and token: the bridge maps them to its RTMPS destinations. */
  readonly room?: string;
  readonly token?: string;
  /** Participant identity for on-air labels. */
  readonly name?: string;
  readonly title?: string;
  readonly tracks: readonly ('video' | 'audio')[];
  readonly userAgent?: string;
}

export type VideoCodecFamily = 'h264' | 'vp8';
export type AudioCodecFamily = 'aac' | 'opus';

export interface VideoTrackConfig {
  readonly track: 'video';
  readonly codec: string;
  readonly family: VideoCodecFamily;
  readonly width: number;
  readonly height: number;
  readonly framerate: number;
  readonly bitrate: number;
  /** Base64 decoder configuration (avcC for H.264). */
  readonly description?: string;
}

export interface AudioTrackConfig {
  readonly track: 'audio';
  readonly codec: string;
  readonly family: AudioCodecFamily;
  readonly sampleRate: number;
  readonly channels: number;
  readonly bitrate: number;
  /** Base64 decoder configuration (AudioSpecificConfig for AAC, OpusHead for Opus). */
  readonly description?: string;
}

export type TrackConfig = VideoTrackConfig | AudioTrackConfig;

export interface ByePayload {
  readonly reason: string;
}

const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder();

export function encodeJsonPayload(value: unknown): Uint8Array {
  return utf8Encoder.encode(JSON.stringify(value));
}

export function decodeJsonPayload<T>(payload: Uint8Array): T {
  try {
    return JSON.parse(utf8Decoder.decode(payload)) as T;
  } catch (error) {
    throw new ProtocolError(`invalid JSON payload: ${(error as Error).message}`);
  }
}

export function trackIdOf(track: 'video' | 'audio'): TrackId {
  return track === 'video' ? TrackId.Video : TrackId.Audio;
}

// ---------------------------------------------------------------------------
// Bridge → client messages (JSON text)
// ---------------------------------------------------------------------------

export type BridgeMessage =
  | { readonly type: 'welcome'; readonly streamId: string; readonly resumed: boolean }
  | { readonly type: 'keyframe-request'; readonly track?: 'video' }
  | { readonly type: 'pong'; readonly timestampUs: number }
  | { readonly type: 'ack'; readonly sequence: number }
  | {
      readonly type: 'status';
      readonly state: 'connecting' | 'publishing' | 'reconnecting' | 'stopped';
      readonly detail?: string;
    }
  | {
      readonly type: 'error';
      readonly code: string;
      readonly message: string;
      /** Fatal errors must not trigger a client reconnection. */
      readonly fatal: boolean;
    };

const STATUS_STATES = new Set(['connecting', 'publishing', 'reconnecting', 'stopped']);

export function parseBridgeMessage(text: string): BridgeMessage {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ProtocolError('bridge message is not valid JSON');
  }
  if (typeof raw !== 'object' || raw === null) {
    throw new ProtocolError('bridge message must be a JSON object');
  }
  const msg = raw as Record<string, unknown>;
  switch (msg.type) {
    case 'welcome':
      if (typeof msg.streamId !== 'string') throw new ProtocolError('welcome.streamId missing');
      return { type: 'welcome', streamId: msg.streamId, resumed: msg.resumed === true };
    case 'keyframe-request':
      return { type: 'keyframe-request' };
    case 'pong':
      if (typeof msg.timestampUs !== 'number') throw new ProtocolError('pong.timestampUs missing');
      return { type: 'pong', timestampUs: msg.timestampUs };
    case 'ack':
      if (typeof msg.sequence !== 'number') throw new ProtocolError('ack.sequence missing');
      return { type: 'ack', sequence: msg.sequence };
    case 'status':
      if (typeof msg.state !== 'string' || !STATUS_STATES.has(msg.state)) {
        throw new ProtocolError(`invalid status.state: ${String(msg.state)}`);
      }
      return {
        type: 'status',
        state: msg.state as 'connecting' | 'publishing' | 'reconnecting' | 'stopped',
        ...(typeof msg.detail === 'string' ? { detail: msg.detail } : {}),
      };
    case 'error':
      return {
        type: 'error',
        code: typeof msg.code === 'string' ? msg.code : 'unknown',
        message: typeof msg.message === 'string' ? msg.message : '',
        fatal: msg.fatal === true,
      };
    default:
      throw new ProtocolError(`unknown bridge message type: ${String(msg.type)}`);
  }
}

// ---------------------------------------------------------------------------
// Base64 helpers (decoder descriptions travel inside JSON)
// ---------------------------------------------------------------------------

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
