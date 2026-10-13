export type ContainerFormat = 'ogv';

/**
 * Driven port for container/codec conversions WebCodecs cannot produce
 * (e.g. Ogg/Theora). Implemented with ffmpeg.wasm, loaded on demand.
 */
export interface TranscoderPort {
  transcode(
    input: Blob,
    format: ContainerFormat,
    onProgress?: (ratio: number) => void,
  ): Promise<Blob>;
}
