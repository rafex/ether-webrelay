import type { SendEncoding } from '../../domain/quality-profile';
import type { IceCandidateData, IceServerConfig } from '../../domain/signaling';
import type { MediaTrackLike } from '../../ports/media';
import type {
  PeerConnectionFactory,
  PeerConnectionLike,
  PeerConnectionState,
  PeerHandlers,
  PeerSender,
  StatsRecord,
} from '../../ports/peer-connection';

/** PeerConnectionFactory backed by the browser's RTCPeerConnection. */
export const browserPeerConnectionFactory: PeerConnectionFactory = {
  create: (config, handlers) => new BrowserPeerConnection(config.iceServers, handlers),
};

class BrowserPeerConnection implements PeerConnectionLike {
  private readonly pc: RTCPeerConnection;

  constructor(iceServers: readonly IceServerConfig[], handlers: PeerHandlers) {
    this.pc = new RTCPeerConnection({
      iceServers: iceServers.map((server) => ({
        urls: typeof server.urls === 'string' ? server.urls : [...server.urls],
        ...(server.username ? { username: server.username } : {}),
        ...(server.credential ? { credential: server.credential } : {}),
      })),
      bundlePolicy: 'max-bundle',
    });
    this.pc.addEventListener('icecandidate', (event) => {
      if (!event.candidate) return;
      handlers.onIceCandidate({
        candidate: event.candidate.candidate,
        sdpMid: event.candidate.sdpMid,
        sdpMLineIndex: event.candidate.sdpMLineIndex,
      });
    });
    this.pc.addEventListener('track', (event) => {
      handlers.onTrack({ mid: event.transceiver.mid, track: event.track });
    });
    this.pc.addEventListener('connectionstatechange', () => {
      handlers.onConnectionStateChange(this.pc.connectionState as PeerConnectionState);
    });
  }

  addSender(track: MediaTrackLike, encoding?: SendEncoding): PeerSender {
    const transceiver = this.pc.addTransceiver(track as MediaStreamTrack, {
      direction: 'sendonly',
      ...(encoding ? { sendEncodings: [{ ...encoding }] } : {}),
    });
    return new BrowserSender(transceiver);
  }

  async createOffer(options?: { readonly iceRestart?: boolean }): Promise<string> {
    const offer = await this.pc.createOffer(options?.iceRestart ? { iceRestart: true } : {});
    await this.pc.setLocalDescription(offer);
    return this.pc.localDescription?.sdp ?? offer.sdp ?? '';
  }

  async acceptAnswer(sdp: string): Promise<void> {
    await this.pc.setRemoteDescription({ type: 'answer', sdp });
  }

  async acceptOffer(sdp: string): Promise<string> {
    await this.pc.setRemoteDescription({ type: 'offer', sdp });
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    return this.pc.localDescription?.sdp ?? answer.sdp ?? '';
  }

  async addIceCandidate(candidate: IceCandidateData): Promise<void> {
    await this.pc.addIceCandidate({
      candidate: candidate.candidate,
      sdpMid: candidate.sdpMid ?? null,
      sdpMLineIndex: candidate.sdpMLineIndex ?? null,
    });
  }

  async stats(): Promise<readonly StatsRecord[]> {
    const report = await this.pc.getStats();
    return [...report.values()] as StatsRecord[];
  }

  close(): void {
    this.pc.close();
  }
}

class BrowserSender implements PeerSender {
  private readonly sender: RTCRtpSender;

  constructor(private readonly transceiver: RTCRtpTransceiver) {
    this.sender = transceiver.sender;
  }

  get mid(): string | null {
    return this.transceiver.mid;
  }

  async replaceTrack(track: MediaTrackLike | null): Promise<void> {
    await this.sender.replaceTrack(track as MediaStreamTrack | null);
  }

  async setEncoding(encoding: SendEncoding): Promise<void> {
    const parameters = this.sender.getParameters();
    // Before negotiation completes some browsers report no encodings yet.
    if (parameters.encodings.length === 0) return;
    parameters.encodings = parameters.encodings.map((current, index) =>
      index === 0 ? { ...current, ...encoding } : current,
    );
    await this.sender.setParameters(parameters);
  }
}
