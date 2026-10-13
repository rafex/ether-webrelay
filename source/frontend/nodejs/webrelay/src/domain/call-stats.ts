/**
 * Turns raw WebRTC stats records (as returned by getStats) into the figures the
 * stats view shows. Rates need two samples, so the previous summary is passed in.
 */
export interface CallStats {
  readonly atMs: number;
  readonly bytesSent: number;
  readonly bytesReceived: number;
  readonly uploadBps: number;
  readonly downloadBps: number;
  readonly rttMs: number | undefined;
  /** Inbound packet loss, 0..100. */
  readonly packetLossPercent: number;
  readonly sendFps: number | undefined;
  readonly sendResolution: string | undefined;
  readonly videoCodec: string | undefined;
  /** host | srflx | relay — "relay" means traffic goes through TURN. */
  readonly candidateType: string | undefined;
}

export const EMPTY_STATS: CallStats = {
  atMs: 0,
  bytesSent: 0,
  bytesReceived: 0,
  uploadBps: 0,
  downloadBps: 0,
  rttMs: undefined,
  packetLossPercent: 0,
  sendFps: undefined,
  sendResolution: undefined,
  videoCodec: undefined,
  candidateType: undefined,
};

type Rec = Readonly<Record<string, unknown>>;

const num = (record: Rec, key: string): number =>
  typeof record[key] === 'number' ? (record[key] as number) : 0;

export function summarizeStats(
  records: readonly Rec[],
  nowMs: number,
  previous: CallStats = EMPTY_STATS,
): CallStats {
  const byId = new Map(records.map((r) => [String(r.id), r]));
  const ofType = (type: string) => records.filter((r) => r.type === type);

  const outbound = ofType('outbound-rtp');
  const inbound = ofType('inbound-rtp');
  const bytesSent = outbound.reduce((sum, r) => sum + num(r, 'bytesSent'), 0);
  const bytesReceived = inbound.reduce((sum, r) => sum + num(r, 'bytesReceived'), 0);

  const packetsReceived = inbound.reduce((sum, r) => sum + num(r, 'packetsReceived'), 0);
  const packetsLost = inbound.reduce((sum, r) => sum + Math.max(0, num(r, 'packetsLost')), 0);
  const expected = packetsReceived + packetsLost;

  const pair = ofType('candidate-pair').find(
    (r) => r.state === 'succeeded' && (r.nominated === true || r.selected === true),
  );
  const rtt =
    pair && typeof pair.currentRoundTripTime === 'number'
      ? Math.round(pair.currentRoundTripTime * 1000)
      : undefined;
  const local = pair ? byId.get(String(pair.localCandidateId)) : undefined;

  const video = outbound
    .filter((r) => r.kind === 'video')
    .sort((a, b) => num(b, 'frameHeight') - num(a, 'frameHeight'))[0];
  const codec = video ? byId.get(String(video.codecId)) : undefined;

  const elapsedSec = previous.atMs > 0 ? (nowMs - previous.atMs) / 1000 : 0;
  const rate = (now: number, before: number) =>
    elapsedSec > 0 && now >= before ? Math.round(((now - before) * 8) / elapsedSec) : 0;

  return {
    atMs: nowMs,
    bytesSent,
    bytesReceived,
    uploadBps: rate(bytesSent, previous.bytesSent),
    downloadBps: rate(bytesReceived, previous.bytesReceived),
    rttMs: rtt,
    packetLossPercent: expected > 0 ? Math.round((packetsLost / expected) * 1000) / 10 : 0,
    sendFps: video && typeof video.framesPerSecond === 'number' ? video.framesPerSecond : undefined,
    sendResolution:
      video && num(video, 'frameWidth') > 0
        ? `${num(video, 'frameWidth')}x${num(video, 'frameHeight')}`
        : undefined,
    videoCodec:
      codec && typeof codec.mimeType === 'string'
        ? codec.mimeType.replace(/^video\//, '')
        : undefined,
    candidateType:
      local && typeof local.candidateType === 'string' ? local.candidateType : undefined,
  };
}
