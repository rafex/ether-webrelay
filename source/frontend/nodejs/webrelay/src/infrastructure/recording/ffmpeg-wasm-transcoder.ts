import type { FFmpeg } from '@ffmpeg/ffmpeg';
import type { ContainerFormat, TranscoderPort } from '../../ports/transcoder';

const TARGETS: Record<
  ContainerFormat,
  { readonly file: string; readonly mime: string; readonly args: string[] }
> = {
  // Theora + Vorbis in Ogg: formats WebCodecs cannot produce.
  ogv: {
    file: 'output.ogv',
    mime: 'video/ogg',
    args: ['-c:v', 'libtheora', '-q:v', '7', '-c:a', 'libvorbis', '-q:a', '4'],
  },
};

/**
 * TranscoderPort backed by ffmpeg.wasm. The ~30 MB core is self-hosted (bundled
 * by Vite) and only downloaded the first time a transcode is requested, so it
 * never slows down live streaming.
 */
export class FfmpegWasmTranscoder implements TranscoderPort {
  private instance: Promise<FFmpeg> | undefined;

  async transcode(
    input: Blob,
    format: ContainerFormat,
    onProgress?: (ratio: number) => void,
  ): Promise<Blob> {
    const ffmpeg = await this.load();
    const target = TARGETS[format];
    const inputName = 'input.webm';
    const listener = ({ progress }: { progress: number }) =>
      onProgress?.(Math.min(1, Math.max(0, progress)));
    ffmpeg.on('progress', listener);
    try {
      await ffmpeg.writeFile(inputName, new Uint8Array(await input.arrayBuffer()));
      const exitCode = await ffmpeg.exec(['-i', inputName, ...target.args, target.file]);
      if (exitCode !== 0) throw new Error(`ffmpeg exited with code ${exitCode}`);
      const output = await ffmpeg.readFile(target.file);
      if (typeof output === 'string') throw new Error('unexpected text output from ffmpeg');
      return new Blob([output.slice()], { type: target.mime });
    } finally {
      ffmpeg.off('progress', listener);
      await Promise.allSettled([ffmpeg.deleteFile(inputName), ffmpeg.deleteFile(target.file)]);
    }
  }

  private load(): Promise<FFmpeg> {
    this.instance ??= (async () => {
      const [{ FFmpeg }, core, wasm] = await Promise.all([
        import('@ffmpeg/ffmpeg'),
        import('@ffmpeg/core?url'),
        import('@ffmpeg/core/wasm?url'),
      ]);
      const ffmpeg = new FFmpeg();
      await ffmpeg.load({ coreURL: core.default, wasmURL: wasm.default });
      return ffmpeg;
    })();
    this.instance.catch(() => {
      this.instance = undefined; // allow retrying after a failed download
    });
    return this.instance;
  }
}
