// Development / E2E stand-in for the Ether WebRelay bridge.
//
// Implements signaling v2 (docs/signaling.md) and a minimal SFU with werift:
// every participant publishes to the bridge and receives everybody else's
// tracks. It does NOT publish RTMPS — the real bridge lives elsewhere (DEC-0001).
//
//   node tests/support/dev-bridge.mjs --port 8090
//
// Test hooks: token "invalid" → fatal invalid-token; room "closed" → room-not-found.

import { pathToFileURL } from 'node:url';
import { MediaStreamTrack, RTCPeerConnection, RTCRtpCodecParameters } from 'werift';
import { WebSocketServer } from 'ws';

const SUBPROTOCOL = 'ether-webrelay.signaling.v2';

const PROFILE = {
  width: 1280,
  height: 720,
  framerate: 30,
  videoBitrate: 1_500_000,
  audioBitrate: 96_000,
  screenFramerate: 15,
  screenBitrate: 2_000_000,
};

const codecs = () => ({
  audio: [new RTCRtpCodecParameters({ mimeType: 'audio/opus', clockRate: 48000, channels: 2 })],
  video: [
    new RTCRtpCodecParameters({
      mimeType: 'video/VP8',
      clockRate: 90000,
      rtcpFeedback: [{ type: 'nack' }, { type: 'nack', parameter: 'pli' }, { type: 'goog-remb' }],
    }),
  ],
});

export async function startDevBridge({ port = 8090, host = '127.0.0.1', log = () => {} } = {}) {
  const rooms = new Map();
  let nextId = 1;

  const server = new WebSocketServer({
    host,
    port,
    handleProtocols: (protocols) => (protocols.has(SUBPROTOCOL) ? SUBPROTOCOL : false),
  });
  await new Promise((resolve) => server.once('listening', resolve));

  server.on('connection', (socket) => {
    const session = { socket, room: undefined, participant: undefined };
    const send = (message) =>
      socket.readyState === socket.OPEN && socket.send(JSON.stringify(message));

    socket.on('message', async (data) => {
      let message;
      try {
        message = JSON.parse(String(data));
      } catch {
        return;
      }
      try {
        await handle(session, message, send);
      } catch (error) {
        log(`error handling ${message.type}: ${error.message}`);
      }
    });
    socket.on('close', () => {
      if (session.participant) leave(session.room, session.participant);
    });
  });

  async function handle(session, message, send) {
    switch (message.type) {
      case 'ping':
        send({ type: 'pong', t: message.t });
        return;
      case 'room.peek': {
        if (message.token === 'invalid') {
          send({ type: 'error', code: 'invalid-token', message: 'token rejected', fatal: true });
          session.socket.close(4401, 'invalid-token');
          return;
        }
        if (message.room === 'closed') {
          send({ type: 'error', code: 'room-not-found', message: 'no such room', fatal: true });
          session.socket.close(4404, 'room-not-found');
          return;
        }
        session.room = roomFor(message.room);
        send({ type: 'room.info', ...session.room.info });
        return;
      }
      case 'join':
        return join(session, message, send);
      case 'publish.offer':
        return publish(session.participant, message);
      case 'subscribe.answer':
        return subscribeAnswered(session.participant, message.sdp);
      case 'ice': {
        const participant = session.participant;
        const pc = message.pc === 'publish' ? participant?.publishPc : participant?.subscribePc;
        if (pc && message.candidate?.candidate) await pc.addIceCandidate(message.candidate);
        return;
      }
      case 'self.update': {
        const participant = session.participant;
        if (!participant) return;
        Object.assign(participant.info, {
          muted: Boolean(message.muted),
          cameraOff: Boolean(message.cameraOff),
          screenSharing: Boolean(message.screenSharing),
        });
        broadcast(session.room, participant, {
          type: 'participant.updated',
          participant: participant.info,
        });
        return;
      }
      case 'leave':
        if (session.participant) leave(session.room, session.participant);
        session.participant = undefined;
        return;
      default:
    }
  }

  function roomFor(id) {
    let room = rooms.get(id);
    if (!room) {
      room = {
        id,
        info: {
          room: id,
          title: `Sala de pruebas · ${id}`,
          host: { name: 'Anfitrión de pruebas' },
          channels: ['youtube', 'twitch'],
        },
        participants: new Map(),
      };
      rooms.set(id, room);
    }
    return room;
  }

  async function join(session, message, send) {
    const room = session.room;
    if (!room) {
      send({ type: 'error', code: 'room-not-found', message: 'peek first', fatal: true });
      return;
    }
    const resumed = message.resume ? room.participants.get(message.resume) : undefined;
    if (resumed) {
      resumed.send = send;
      session.participant = resumed;
      send({
        type: 'welcome',
        self: resumed.info.id,
        resumed: true,
        profile: PROFILE,
        iceServers: [],
        participants: [...room.participants.values()].map((p) => p.info),
      });
      return;
    }
    const id = `p-${nextId++}`;
    const participant = {
      info: {
        id,
        name: String(message.name ?? 'Invitado').slice(0, 60),
        ...(message.title ? { title: String(message.title).slice(0, 80) } : {}),
        muted: false,
        cameraOff: !message.media?.video,
        screenSharing: false,
      },
      send,
      publishPc: undefined,
      subscribePc: undefined,
      /** source -> { track, receiverPli } published by this participant */
      published: new Map(),
      /** `${publisherId}:${source}` -> mid in this participant's subscribe pc */
      forwarded: new Map(),
      negotiating: false,
      renegotiate: false,
    };
    room.participants.set(id, participant);
    session.participant = participant;
    log(`${participant.info.name} joined ${room.id} as ${id}`);

    send({
      type: 'welcome',
      self: id,
      resumed: false,
      profile: PROFILE,
      iceServers: [],
      participants: [...room.participants.values()].map((p) => p.info),
    });
    broadcast(room, participant, { type: 'participant.joined', participant: participant.info });

    participant.subscribePc = new RTCPeerConnection({ codecs: codecs() });
    participant.subscribePc.onIceCandidate.subscribe((candidate) => {
      if (candidate) send({ type: 'ice', pc: 'subscribe', candidate: candidate.toJSON() });
    });
    for (const other of room.participants.values()) {
      if (other === participant) continue;
      for (const [source, entry] of other.published) forward(entry, other, source, participant);
    }
    await renegotiateSubscribe(participant);
  }

  async function publish(participant, message) {
    if (!participant) return;
    const room = [...rooms.values()].find(
      (r) => r.participants.get(participant.info.id) === participant,
    );
    if (!participant.publishPc) {
      const pc = new RTCPeerConnection({ codecs: codecs() });
      participant.publishPc = pc;
      pc.onIceCandidate.subscribe((candidate) => {
        if (candidate)
          participant.send({ type: 'ice', pc: 'publish', candidate: candidate.toJSON() });
      });
      pc.onTransceiverAdded.subscribe((transceiver) => {
        transceiver.onTrack.subscribe((track) => {
          const source = participant.pendingSources?.[transceiver.mid];
          if (!source) return;
          const entry = {
            track,
            pli: () => transceiver.receiver.sendRtcpPLI(track.ssrc),
          };
          participant.published.set(source, entry);
          log(`${participant.info.id} publishes ${source}`);
          for (const other of room.participants.values()) {
            if (other === participant) continue;
            forward(entry, participant, source, other);
            void renegotiateSubscribe(other);
          }
        });
      });
    }
    participant.pendingSources = message.sources ?? {};
    await participant.publishPc.setRemoteDescription({ type: 'offer', sdp: message.sdp });
    const answer = await participant.publishPc.createAnswer();
    await participant.publishPc.setLocalDescription(answer);
    participant.send({ type: 'publish.answer', sdp: participant.publishPc.localDescription.sdp });
  }

  /** Adds a sendonly transceiver in `subscriber` that relays `entry` RTP. */
  function forward(entry, publisher, source, subscriber) {
    const key = `${publisher.info.id}:${source}`;
    if (subscriber.forwarded.has(key)) return;
    const outgoing = new MediaStreamTrack({ kind: entry.track.kind });
    const transceiver = subscriber.subscribePc.addTransceiver(outgoing, { direction: 'sendonly' });
    entry.track.onReceiveRtp.subscribe((rtp) => outgoing.writeRtp(rtp));
    subscriber.forwarded.set(key, { transceiver, publisher, source, entry });
  }

  async function renegotiateSubscribe(participant) {
    // An offer without media sections is invalid for browsers using max-bundle.
    if (participant.forwarded.size === 0) return;
    if (participant.negotiating) {
      participant.renegotiate = true;
      return;
    }
    participant.negotiating = true;
    const pc = participant.subscribePc;
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const tracks = {};
    for (const { transceiver, publisher, source } of participant.forwarded.values()) {
      if (transceiver.mid) tracks[transceiver.mid] = { participant: publisher.info.id, source };
    }
    participant.send({ type: 'tracks', tracks });
    participant.send({ type: 'subscribe.offer', sdp: pc.localDescription.sdp });
  }

  async function subscribeAnswered(participant, sdp) {
    if (!participant?.subscribePc) return;
    await participant.subscribePc.setRemoteDescription({ type: 'answer', sdp });
    participant.negotiating = false;
    // New viewers need a keyframe to start decoding.
    for (const { entry } of participant.forwarded.values()) {
      if (entry.track.kind === 'video') setTimeout(() => entry.pli(), 200);
    }
    if (participant.renegotiate) {
      participant.renegotiate = false;
      await renegotiateSubscribe(participant);
    }
  }

  function broadcast(room, except, message) {
    if (!room) return;
    for (const participant of room.participants.values()) {
      if (participant !== except) participant.send(message);
    }
  }

  function leave(room, participant) {
    if (!room?.participants.has(participant.info.id)) return;
    room.participants.delete(participant.info.id);
    participant.publishPc?.close();
    participant.subscribePc?.close();
    broadcast(room, participant, { type: 'participant.left', id: participant.info.id });
    log(`${participant.info.id} left ${room.id}`);
  }

  return {
    url: `ws://${host}:${server.address().port}/signal`,
    rooms,
    close: async () => {
      for (const room of rooms.values()) for (const p of room.participants.values()) leave(room, p);
      for (const client of server.clients) client.terminate();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

// CLI: node tests/support/dev-bridge.mjs [--port 8090] [--host 127.0.0.1]
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const arg = (name, fallback) => {
    const index = process.argv.indexOf(`--${name}`);
    return index > -1 ? process.argv[index + 1] : fallback;
  };
  const bridge = await startDevBridge({
    port: Number(arg('port', '8090')),
    host: arg('host', '127.0.0.1'),
    log: (line) => console.log(`[dev-bridge] ${line}`),
  });
  console.log(`[dev-bridge] signaling v2 on ${bridge.url}`);
  console.log('[dev-bridge] abre http://localhost:5173/join/demo?t=dev en dos pestañas');
  process.on('SIGINT', () => void bridge.close().then(() => process.exit(0)));
}
