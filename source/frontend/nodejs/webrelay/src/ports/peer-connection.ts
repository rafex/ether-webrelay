import type { SendEncoding } from '../domain/quality-profile';
import type { IceCandidateData, IceServerConfig } from '../domain/signaling';
import type { MediaTrackLike } from './media';

export type PeerConnectionState =
  | 'new'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'failed'
  | 'closed';

export interface RemoteTrackEvent {
  /** Transceiver mid; the bridge maps it to a participant and source via `tracks`. */
  readonly mid: string | null;
  readonly track: MediaTrackLike;
}

export interface PeerHandlers {
  onIceCandidate(candidate: IceCandidateData): void;
  onTrack(event: RemoteTrackEvent): void;
  onConnectionStateChange(state: PeerConnectionState): void;
}

export interface PeerSender {
  replaceTrack(track: MediaTrackLike | null): Promise<void>;
  setEncoding(encoding: SendEncoding): Promise<void>;
}

/** One raw entry of RTCPeerConnection.getStats(); summarized by domain/call-stats. */
export type StatsRecord = Readonly<Record<string, unknown>>;

/**
 * The slice of RTCPeerConnection the call needs, phrased as whole negotiation
 * steps so fakes stay trivial. Implemented by infrastructure/webrtc.
 */
export interface PeerConnectionLike {
  /** Adds a sendonly transceiver for `track`, with initial encoding limits. */
  addSender(track: MediaTrackLike, encoding?: SendEncoding): PeerSender;
  /** createOffer + setLocalDescription; returns the offer SDP. */
  createOffer(options?: { readonly iceRestart?: boolean }): Promise<string>;
  acceptAnswer(sdp: string): Promise<void>;
  /** setRemoteDescription(offer) + createAnswer + setLocalDescription; returns the answer SDP. */
  acceptOffer(sdp: string): Promise<string>;
  addIceCandidate(candidate: IceCandidateData): Promise<void>;
  stats(): Promise<readonly StatsRecord[]>;
  close(): void;
}

export interface PeerConnectionFactory {
  create(
    config: { readonly iceServers: readonly IceServerConfig[] },
    handlers: PeerHandlers,
  ): PeerConnectionLike;
}
