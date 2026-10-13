import type { AudioCodecFamily, VideoCodecFamily } from './protocol';

export interface CodecCandidate<F extends string> {
  readonly family: F;
  /** WebCodecs codec string, e.g. `avc1.640028`, `vp8`, `mp4a.40.2`, `opus`. */
  readonly codec: string;
}

export type H264Profile = 'baseline' | 'main' | 'high';

const H264_PROFILE_PREFIX: Record<H264Profile, string> = {
  // profile_idc + constraint flags (constrained baseline sets constraint_set0/1)
  baseline: '42E0',
  main: '4D40',
  high: '6400',
};

/** H.264 levels, Table A-1: max frame size (macroblocks) and max rate (MB/s). */
const H264_LEVELS: readonly {
  readonly idc: number;
  readonly maxFs: number;
  readonly maxMbps: number;
}[] = [
  { idc: 30, maxFs: 1_620, maxMbps: 40_500 },
  { idc: 31, maxFs: 3_600, maxMbps: 108_000 },
  { idc: 32, maxFs: 5_120, maxMbps: 216_000 },
  { idc: 40, maxFs: 8_192, maxMbps: 245_760 },
  { idc: 42, maxFs: 8_704, maxMbps: 522_240 },
  { idc: 50, maxFs: 22_080, maxMbps: 589_824 },
  { idc: 51, maxFs: 36_864, maxMbps: 983_040 },
  { idc: 52, maxFs: 36_864, maxMbps: 2_073_600 },
];

/** Smallest H.264 level able to carry `width`×`height` at `framerate`. */
export function h264Level(width: number, height: number, framerate: number): number {
  const frameMbs = Math.ceil(width / 16) * Math.ceil(height / 16);
  const mbps = frameMbs * framerate;
  const level = H264_LEVELS.find((l) => frameMbs <= l.maxFs && mbps <= l.maxMbps);
  if (!level) throw new RangeError(`no H.264 level fits ${width}x${height}@${framerate}`);
  return level.idc;
}

export function h264CodecString(
  profile: H264Profile,
  width: number,
  height: number,
  framerate: number,
): string {
  const level = h264Level(width, height, framerate).toString(16).toUpperCase().padStart(2, '0');
  return `avc1.${H264_PROFILE_PREFIX[profile]}${level}`;
}

/**
 * Video candidates in preference order. H.264 first because RTMP/FLV carries
 * it natively (the bridge can remux without transcoding); VP8 is the fallback
 * for browsers without an H.264 encoder and requires the bridge to transcode.
 */
export function videoCandidates(
  width: number,
  height: number,
  framerate: number,
  preferred: VideoCodecFamily = 'h264',
): CodecCandidate<VideoCodecFamily>[] {
  const h264: CodecCandidate<VideoCodecFamily>[] = (['high', 'main', 'baseline'] as const).map(
    (profile) => ({ family: 'h264', codec: h264CodecString(profile, width, height, framerate) }),
  );
  const vp8: CodecCandidate<VideoCodecFamily>[] = [{ family: 'vp8', codec: 'vp8' }];
  return preferred === 'vp8' ? [...vp8, ...h264] : [...h264, ...vp8];
}

/** AAC-LC first (native in FLV); Opus as fallback (bridge transcodes to AAC). */
export function audioCandidates(
  preferred: AudioCodecFamily = 'aac',
): CodecCandidate<AudioCodecFamily>[] {
  const aac: CodecCandidate<AudioCodecFamily> = { family: 'aac', codec: 'mp4a.40.2' };
  const opus: CodecCandidate<AudioCodecFamily> = { family: 'opus', codec: 'opus' };
  return preferred === 'opus' ? [opus, aac] : [aac, opus];
}

/** First candidate the platform reports as supported, probing in order. */
export async function selectCodec<C>(
  candidates: readonly C[],
  isSupported: (candidate: C) => Promise<boolean>,
): Promise<C | undefined> {
  for (const candidate of candidates) {
    try {
      if (await isSupported(candidate)) return candidate;
    } catch {
      // A throwing probe means "not supported" for this candidate.
    }
  }
  return undefined;
}
