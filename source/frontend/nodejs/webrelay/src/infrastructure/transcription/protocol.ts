/** Messages between the page and the transcription worker (see whisper.worker.ts). */

export type ToWorker =
  | {
      readonly type: 'init';
      /** Folder with `whisper-tiny/` (the model); the WebAssembly runtime ships with the bundle. */
      readonly baseUrl: string;
      /** Whisper language code ("es"), or '' to let the model detect it. */
      readonly language: string;
    }
  | { readonly type: 'decode'; readonly id: number; readonly audio: Float32Array };

export type FromWorker =
  | { readonly type: 'ready' }
  | { readonly type: 'text'; readonly id: number; readonly text: string }
  | { readonly type: 'error'; readonly id?: number; readonly message: string };

/** The model folder inside `baseUrl` (the Containerfile puts it there). */
export const MODEL_NAME = 'whisper-tiny';
