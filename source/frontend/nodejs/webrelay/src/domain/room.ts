import type { MediaSource, ParticipantInfo, ServerMessage, TrackInfo } from './signaling';

/** Immutable view of the call as known from signaling. */
export interface RoomState {
  readonly self: string | undefined;
  /** Remote participants in join order (never includes `self`). */
  readonly participants: readonly ParticipantInfo[];
  /** Remote tracks keyed by the subscribe transceiver `mid`. */
  readonly tracks: Readonly<Record<string, TrackInfo>>;
}

export const EMPTY_ROOM: RoomState = { self: undefined, participants: [], tracks: {} };

/** Pure reducer: folds signaling messages into the room state. Unrelated messages are ignored. */
export function reduceRoom(state: RoomState, message: ServerMessage): RoomState {
  switch (message.type) {
    case 'welcome':
      return {
        self: message.self,
        participants: message.participants.filter((p) => p.id !== message.self),
        tracks: message.resumed ? state.tracks : {},
      };
    case 'participant.joined':
    case 'participant.updated': {
      const incoming = message.participant;
      if (incoming.id === state.self) return state;
      const exists = state.participants.some((p) => p.id === incoming.id);
      return {
        ...state,
        participants: exists
          ? state.participants.map((p) => (p.id === incoming.id ? incoming : p))
          : [...state.participants, incoming],
      };
    }
    case 'participant.left':
      return {
        ...state,
        participants: state.participants.filter((p) => p.id !== message.id),
        tracks: Object.fromEntries(
          Object.entries(state.tracks).filter(([, track]) => track.participant !== message.id),
        ),
      };
    case 'tracks':
      return { ...state, tracks: { ...state.tracks, ...message.tracks } };
    default:
      return state;
  }
}

/** `mid`s carrying a given participant's source (normally zero or one). */
export function midsFor(state: RoomState, participant: string, source: MediaSource): string[] {
  return Object.entries(state.tracks)
    .filter(([, track]) => track.participant === participant && track.source === source)
    .map(([mid]) => mid);
}

export function trackForMid(state: RoomState, mid: string | null): TrackInfo | undefined {
  return mid === null ? undefined : state.tracks[mid];
}

/** Whoever is sharing a screen gets the spotlight; the newest share wins. */
export function spotlightParticipant(state: RoomState): ParticipantInfo | undefined {
  return [...state.participants].reverse().find((p) => p.screenSharing);
}
