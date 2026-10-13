/**
 * Ether WebRelay signaling protocol, version 2 (WebRTC mode).
 *
 * JSON text messages over a WebSocket negotiated with the
 * `ether-webrelay.signaling.v2` subprotocol. Each participant keeps two
 * peer connections with the bridge's SFU: `publish` (client offers, sendonly)
 * and `subscribe` (bridge offers the remote tracks, client answers).
 * The bridge is free to use any SFU behind this contract; it alone knows
 * about RTMPS. Full contract: docs/signaling.md.
 */
import { ProtocolError } from './errors';
import { parseQualityProfile, type QualityProfile } from './quality-profile';

export const SIGNALING_SUBPROTOCOL = 'ether-webrelay.signaling.v2';

export type TransportMode = 'webrtc' | 'websocket';
export type PeerRole = 'publish' | 'subscribe';
export type MediaSource = 'camera' | 'microphone' | 'screen' | 'screen-audio';

export interface HostInfo {
  readonly name: string;
  readonly avatar?: string;
}

export interface RoomInfo {
  readonly room: string;
  readonly title: string;
  readonly host: HostInfo;
  /** Informative: channels the room is streamed to (youtube, twitch, facebook…). */
  readonly channels: readonly string[];
  readonly transport?: TransportMode;
}

export interface ParticipantInfo {
  readonly id: string;
  readonly name: string;
  readonly title?: string;
  readonly muted: boolean;
  readonly cameraOff: boolean;
  readonly screenSharing: boolean;
}

export interface TrackInfo {
  readonly participant: string;
  readonly source: MediaSource;
}

export interface IceServerConfig {
  readonly urls: string | readonly string[];
  readonly username?: string;
  readonly credential?: string;
}

export interface IceCandidateData {
  readonly candidate: string;
  readonly sdpMid?: string | null;
  readonly sdpMLineIndex?: number | null;
}

export interface SelfState {
  readonly muted: boolean;
  readonly cameraOff: boolean;
  readonly screenSharing: boolean;
}

// ---------------------------------------------------------------------------
// Client → bridge
// ---------------------------------------------------------------------------

export type ClientMessage =
  | { readonly type: 'room.peek'; readonly room: string; readonly token: string }
  | {
      readonly type: 'join';
      readonly name: string;
      readonly title?: string;
      readonly media: { readonly audio: boolean; readonly video: boolean };
      /** Previous participant id when rejoining after a dropped socket. */
      readonly resume?: string;
    }
  | {
      readonly type: 'publish.offer';
      readonly sdp: string;
      /** Which local source each published transceiver carries, by mid. */
      readonly sources: Readonly<Record<string, MediaSource>>;
    }
  | { readonly type: 'subscribe.answer'; readonly sdp: string }
  | { readonly type: 'ice'; readonly pc: PeerRole; readonly candidate: IceCandidateData }
  | ({ readonly type: 'self.update' } & SelfState)
  | { readonly type: 'ping'; readonly t: number }
  | { readonly type: 'leave' };

export function serializeClientMessage(message: ClientMessage): string {
  return JSON.stringify(message);
}

// ---------------------------------------------------------------------------
// Bridge → client
// ---------------------------------------------------------------------------

export type ServerMessage =
  | ({ readonly type: 'room.info' } & RoomInfo)
  | {
      readonly type: 'welcome';
      readonly self: string;
      readonly resumed: boolean;
      readonly profile?: QualityProfile;
      readonly iceServers: readonly IceServerConfig[];
      readonly participants: readonly ParticipantInfo[];
    }
  | { readonly type: 'publish.answer'; readonly sdp: string }
  | { readonly type: 'subscribe.offer'; readonly sdp: string }
  | { readonly type: 'ice'; readonly pc: PeerRole; readonly candidate: IceCandidateData }
  | { readonly type: 'tracks'; readonly tracks: Readonly<Record<string, TrackInfo>> }
  | { readonly type: 'participant.joined'; readonly participant: ParticipantInfo }
  | { readonly type: 'participant.updated'; readonly participant: ParticipantInfo }
  | { readonly type: 'participant.left'; readonly id: string }
  | { readonly type: 'profile'; readonly profile: QualityProfile }
  | { readonly type: 'pong'; readonly t: number }
  | {
      readonly type: 'error';
      readonly code: string;
      readonly message: string;
      /** Fatal errors (bad token, room closed, kicked) must not trigger a reconnection. */
      readonly fatal: boolean;
    };

const MEDIA_SOURCES = new Set<string>(['camera', 'microphone', 'screen', 'screen-audio']);
const PEER_ROLES = new Set<string>(['publish', 'subscribe']);

export function parseServerMessage(text: string): ServerMessage {
  const msg = parseObject(text, 'signaling message');
  switch (msg.type) {
    case 'room.info':
      return { type: 'room.info', ...parseRoomInfo(msg) };
    case 'welcome': {
      const profile = msg.profile === undefined ? undefined : parseQualityProfile(msg.profile);
      if (msg.profile !== undefined && !profile) throw new ProtocolError('welcome.profile invalid');
      return {
        type: 'welcome',
        self: requireString(msg, 'self'),
        resumed: msg.resumed === true,
        ...(profile ? { profile } : {}),
        iceServers: requireArray(msg, 'iceServers', parseIceServer, true),
        participants: requireArray(msg, 'participants', parseParticipant, true),
      };
    }
    case 'publish.answer':
    case 'subscribe.offer':
      return { type: msg.type, sdp: requireString(msg, 'sdp') };
    case 'ice':
      return { type: 'ice', pc: parsePeerRole(msg.pc), candidate: parseCandidate(msg.candidate) };
    case 'tracks':
      return { type: 'tracks', tracks: parseTracks(msg.tracks) };
    case 'participant.joined':
    case 'participant.updated':
      return { type: msg.type, participant: parseParticipant(msg.participant) };
    case 'participant.left':
      return { type: 'participant.left', id: requireString(msg, 'id') };
    case 'profile': {
      const profile = parseQualityProfile(msg.profile);
      if (!profile) throw new ProtocolError('profile invalid');
      return { type: 'profile', profile };
    }
    case 'pong':
      return { type: 'pong', t: requireNumber(msg, 't') };
    case 'error':
      return {
        type: 'error',
        code: typeof msg.code === 'string' ? msg.code : 'unknown',
        message: typeof msg.message === 'string' ? msg.message : '',
        fatal: msg.fatal === true,
      };
    default:
      throw new ProtocolError(`unknown signaling message type: ${String(msg.type)}`);
  }
}

function parseRoomInfo(msg: Record<string, unknown>): RoomInfo {
  const host = msg.host;
  if (typeof host !== 'object' || host === null) throw new ProtocolError('room.info.host missing');
  const hostRecord = host as Record<string, unknown>;
  const transport = msg.transport;
  if (transport !== undefined && transport !== 'webrtc' && transport !== 'websocket') {
    throw new ProtocolError(`invalid transport: ${String(transport)}`);
  }
  return {
    room: requireString(msg, 'room'),
    title: requireString(msg, 'title'),
    host: {
      name: requireString(hostRecord, 'name'),
      ...(isHttpUrl(hostRecord.avatar) ? { avatar: hostRecord.avatar } : {}),
    },
    channels: Array.isArray(msg.channels)
      ? msg.channels.filter((c): c is string => typeof c === 'string')
      : [],
    ...(transport ? { transport } : {}),
  };
}

function parseParticipant(raw: unknown): ParticipantInfo {
  if (typeof raw !== 'object' || raw === null) throw new ProtocolError('participant missing');
  const p = raw as Record<string, unknown>;
  return {
    id: requireString(p, 'id'),
    name: requireString(p, 'name'),
    ...(typeof p.title === 'string' && p.title !== '' ? { title: p.title } : {}),
    muted: p.muted === true,
    cameraOff: p.cameraOff === true,
    screenSharing: p.screenSharing === true,
  };
}

function parseTracks(raw: unknown): Record<string, TrackInfo> {
  if (typeof raw !== 'object' || raw === null) throw new ProtocolError('tracks missing');
  const tracks: Record<string, TrackInfo> = {};
  for (const [mid, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null)
      throw new ProtocolError(`track ${mid} invalid`);
    const t = value as Record<string, unknown>;
    if (typeof t.source !== 'string' || !MEDIA_SOURCES.has(t.source)) {
      throw new ProtocolError(`track ${mid} has invalid source`);
    }
    tracks[mid] = { participant: requireString(t, 'participant'), source: t.source as MediaSource };
  }
  return tracks;
}

function parseIceServer(raw: unknown): IceServerConfig {
  if (typeof raw !== 'object' || raw === null) throw new ProtocolError('iceServer invalid');
  const s = raw as Record<string, unknown>;
  const urls = s.urls;
  const validUrls =
    typeof urls === 'string' ||
    (Array.isArray(urls) && urls.length > 0 && urls.every((u) => typeof u === 'string'));
  if (!validUrls) throw new ProtocolError('iceServer.urls invalid');
  return {
    urls: urls as string | string[],
    ...(typeof s.username === 'string' ? { username: s.username } : {}),
    ...(typeof s.credential === 'string' ? { credential: s.credential } : {}),
  };
}

function parseCandidate(raw: unknown): IceCandidateData {
  if (typeof raw !== 'object' || raw === null) throw new ProtocolError('ice.candidate missing');
  const c = raw as Record<string, unknown>;
  return {
    candidate: typeof c.candidate === 'string' ? c.candidate : '',
    sdpMid: typeof c.sdpMid === 'string' ? c.sdpMid : null,
    sdpMLineIndex: typeof c.sdpMLineIndex === 'number' ? c.sdpMLineIndex : null,
  };
}

function parsePeerRole(raw: unknown): PeerRole {
  if (typeof raw !== 'string' || !PEER_ROLES.has(raw)) {
    throw new ProtocolError(`invalid peer role: ${String(raw)}`);
  }
  return raw as PeerRole;
}

function parseObject(text: string, what: string): Record<string, unknown> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ProtocolError(`${what} is not valid JSON`);
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ProtocolError(`${what} must be a JSON object`);
  }
  return raw as Record<string, unknown>;
}

function requireString(obj: Record<string, unknown>, key: string): string {
  const value = obj[key];
  if (typeof value !== 'string' || value === '') throw new ProtocolError(`${key} missing`);
  return value;
}

function requireNumber(obj: Record<string, unknown>, key: string): number {
  const value = obj[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ProtocolError(`${key} missing`);
  }
  return value;
}

function requireArray<T>(
  obj: Record<string, unknown>,
  key: string,
  parse: (raw: unknown) => T,
  optional = false,
): T[] {
  const value = obj[key];
  if (value === undefined && optional) return [];
  if (!Array.isArray(value)) throw new ProtocolError(`${key} must be an array`);
  return value.map(parse);
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}
