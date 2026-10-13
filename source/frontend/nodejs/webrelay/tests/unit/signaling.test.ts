import { describe, expect, it } from 'vitest';
import { ProtocolError } from '../../src/domain/errors';
import { DEFAULT_PROFILE } from '../../src/domain/quality-profile';
import {
  EMPTY_ROOM,
  midsFor,
  reduceRoom,
  spotlightParticipant,
  trackForMid,
} from '../../src/domain/room';
import {
  type ParticipantInfo,
  parseServerMessage,
  type ServerMessage,
  serializeClientMessage,
} from '../../src/domain/signaling';

const ana: ParticipantInfo = {
  id: 'p-ana',
  name: 'Ana',
  muted: false,
  cameraOff: false,
  screenSharing: false,
};
const beto: ParticipantInfo = { ...ana, id: 'p-beto', name: 'Beto' };

const parse = (value: object) => parseServerMessage(JSON.stringify(value));

describe('parseServerMessage', () => {
  it('parses room.info, keeping only http(s) avatars and string channels', () => {
    expect(
      parse({
        type: 'room.info',
        room: 'jdh-s02e38',
        title: 'Jueves de Hacking S02 EP38',
        host: { name: 'ichavero1', avatar: 'javascript:alert(1)' },
        channels: ['youtube', 3, 'twitch'],
        transport: 'webrtc',
      }),
    ).toEqual({
      type: 'room.info',
      room: 'jdh-s02e38',
      title: 'Jueves de Hacking S02 EP38',
      host: { name: 'ichavero1' },
      channels: ['youtube', 'twitch'],
      transport: 'webrtc',
    });
  });

  it('parses welcome with profile, ICE servers and participants', () => {
    const message = parse({
      type: 'welcome',
      self: 'p-me',
      resumed: false,
      profile: { width: 1920, height: 1080, framerate: 30 },
      iceServers: [
        { urls: ['stun:stun.example.com'] },
        { urls: 'turn:t', username: 'u', credential: 'c' },
      ],
      participants: [ana, { id: 'p-x', name: 'X', title: '' }],
    });
    expect(message).toMatchObject({
      type: 'welcome',
      self: 'p-me',
      profile: { ...DEFAULT_PROFILE, width: 1920, height: 1080 },
      iceServers: [
        { urls: ['stun:stun.example.com'] },
        { urls: 'turn:t', username: 'u', credential: 'c' },
      ],
    });
    if (message.type === 'welcome') {
      expect(message.participants[1]).toEqual({
        id: 'p-x',
        name: 'X',
        muted: false,
        cameraOff: false,
        screenSharing: false,
      });
    }
  });

  it('parses negotiation, tracks, presence, profile, pong and errors', () => {
    expect(parse({ type: 'publish.answer', sdp: 'v=0' })).toEqual({
      type: 'publish.answer',
      sdp: 'v=0',
    });
    expect(parse({ type: 'subscribe.offer', sdp: 'v=0' })).toEqual({
      type: 'subscribe.offer',
      sdp: 'v=0',
    });
    expect(
      parse({
        type: 'ice',
        pc: 'subscribe',
        candidate: { candidate: 'a', sdpMid: '0', sdpMLineIndex: 0 },
      }),
    ).toEqual({
      type: 'ice',
      pc: 'subscribe',
      candidate: { candidate: 'a', sdpMid: '0', sdpMLineIndex: 0 },
    });
    expect(
      parse({ type: 'tracks', tracks: { '1': { participant: 'p-ana', source: 'camera' } } }),
    ).toEqual({
      type: 'tracks',
      tracks: { '1': { participant: 'p-ana', source: 'camera' } },
    });
    expect(parse({ type: 'participant.left', id: 'p-ana' })).toEqual({
      type: 'participant.left',
      id: 'p-ana',
    });
    expect(parse({ type: 'profile', profile: { framerate: 24 } })).toMatchObject({
      type: 'profile',
      profile: { framerate: 24 },
    });
    expect(parse({ type: 'pong', t: 5 })).toEqual({ type: 'pong', t: 5 });
    expect(parse({ type: 'error', code: 'room-closed', message: 'bye', fatal: true })).toEqual({
      type: 'error',
      code: 'room-closed',
      message: 'bye',
      fatal: true,
    });
  });

  it.each([
    ['not json', 'nope'],
    ['an array', '[]'],
    ['an unknown type', '{"type":"teleport"}'],
    ['room.info without host', '{"type":"room.info","room":"r","title":"t"}'],
    [
      'an invalid transport',
      '{"type":"room.info","room":"r","title":"t","host":{"name":"h"},"transport":"smoke"}',
    ],
    ['welcome without self', '{"type":"welcome"}'],
    ['an out-of-range profile', '{"type":"welcome","self":"p","profile":{"width":99999}}'],
    ['ice with a bad role', '{"type":"ice","pc":"both","candidate":{}}'],
    [
      'a track with a bad source',
      '{"type":"tracks","tracks":{"0":{"participant":"p","source":"radio"}}}',
    ],
    ['a bad ICE server', '{"type":"welcome","self":"p","iceServers":[{"urls":[]}]}'],
  ])('rejects %s', (_label, text) => {
    expect(() => parseServerMessage(text)).toThrow(ProtocolError);
  });

  it('serializes client messages as JSON', () => {
    expect(
      JSON.parse(
        serializeClientMessage({ type: 'join', name: 'Raúl', media: { audio: true, video: true } }),
      ),
    ).toEqual({ type: 'join', name: 'Raúl', media: { audio: true, video: true } });
  });
});

describe('reduceRoom', () => {
  const welcome: ServerMessage = {
    type: 'welcome',
    self: 'p-me',
    resumed: false,
    iceServers: [],
    participants: [ana, { ...ana, id: 'p-me', name: 'Yo' }],
  };

  it('starts from welcome without listing self', () => {
    const state = reduceRoom(EMPTY_ROOM, welcome);
    expect(state.self).toBe('p-me');
    expect(state.participants.map((p) => p.id)).toEqual(['p-ana']);
  });

  it('adds, updates and removes participants, dropping their tracks', () => {
    let state = reduceRoom(EMPTY_ROOM, welcome);
    state = reduceRoom(state, { type: 'participant.joined', participant: beto });
    state = reduceRoom(state, {
      type: 'tracks',
      tracks: {
        '0': { participant: 'p-ana', source: 'camera' },
        '1': { participant: 'p-beto', source: 'camera' },
        '2': { participant: 'p-beto', source: 'screen' },
      },
    });
    state = reduceRoom(state, {
      type: 'participant.updated',
      participant: { ...beto, screenSharing: true },
    });
    expect(spotlightParticipant(state)?.id).toBe('p-beto');
    expect(midsFor(state, 'p-beto', 'screen')).toEqual(['2']);
    expect(trackForMid(state, '0')).toEqual({ participant: 'p-ana', source: 'camera' });
    expect(trackForMid(state, null)).toBeUndefined();

    state = reduceRoom(state, { type: 'participant.left', id: 'p-beto' });
    expect(state.participants.map((p) => p.id)).toEqual(['p-ana']);
    expect(Object.keys(state.tracks)).toEqual(['0']);
    expect(spotlightParticipant(state)).toBeUndefined();
  });

  it('ignores presence events about self and unrelated messages', () => {
    const state = reduceRoom(EMPTY_ROOM, welcome);
    expect(
      reduceRoom(state, { type: 'participant.joined', participant: { ...ana, id: 'p-me' } }),
    ).toBe(state);
    expect(reduceRoom(state, { type: 'pong', t: 1 })).toBe(state);
  });

  it('keeps known tracks when the bridge resumes the session', () => {
    let state = reduceRoom(EMPTY_ROOM, welcome);
    state = reduceRoom(state, {
      type: 'tracks',
      tracks: { '0': { participant: 'p-ana', source: 'camera' } },
    });
    expect(
      Object.keys(reduceRoom(state, { ...welcome, resumed: true } as ServerMessage).tracks),
    ).toEqual(['0']);
    expect(reduceRoom(state, welcome).tracks).toEqual({});
  });
});
