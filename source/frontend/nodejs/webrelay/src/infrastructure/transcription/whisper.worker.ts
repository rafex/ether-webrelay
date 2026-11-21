/**
 * Worker that runs Whisper (tiny, quantized) with Transformers.js on ONNX Runtime Web (WebAssembly,
 * one thread: the page is not cross-origin isolated). Everything it loads comes from the site's
 * own origin; it never talks to Hugging Face. It lives in a worker so a decode (about a second)
 * never freezes the call's interface or the video effects.
 */
import { env, pipeline } from '@huggingface/transformers';
// By default Transformers.js fetches its WebAssembly runtime from a public CDN (jsDelivr). Importing
// the files as assets makes Vite ship them with the site, so nothing is loaded from a third party.
import ortGlue from '../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs?url';
import ortWasm from '../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm?url';
import { type FromWorker, MODEL_NAME, type ToWorker } from './protocol';

type Recognizer = (
  audio: Float32Array,
  options: Record<string, unknown>,
) => Promise<{ text: string } | { text: string }[]>;

const scope = self as unknown as {
  postMessage(message: FromWorker): void;
  onmessage: ((event: MessageEvent<ToWorker>) => void) | null;
};

let recognizer: Promise<Recognizer> | undefined;
let language = '';

const say = (message: FromWorker) => scope.postMessage(message);
const describeError = (error: unknown) => (error instanceof Error ? error.message : String(error));

function init(baseUrl: string): Promise<Recognizer> {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = base;
  // Its cache of the runtime rewrites the glue code into a blob: URL, which the page's CSP (script-src
  // 'self') rightly refuses. The runtime is a hashed asset of this site: the HTTP cache keeps it.
  env.useWasmCache = false;
  const wasm = env.backends.onnx.wasm;
  if (wasm) {
    wasm.wasmPaths = { mjs: ortGlue, wasm: ortWasm };
    wasm.numThreads = 1;
    wasm.proxy = false;
  }
  return pipeline('automatic-speech-recognition', MODEL_NAME, {
    dtype: 'q8',
    device: 'wasm',
  }) as unknown as Promise<Recognizer>;
}

scope.onmessage = (event) => {
  const message = event.data;
  if (message.type === 'init') {
    language = message.language;
    recognizer = init(message.baseUrl);
    recognizer.then(
      () => say({ type: 'ready' }),
      (error: unknown) => say({ type: 'error', message: describeError(error) }),
    );
    return;
  }
  const pending = recognizer;
  if (!pending) {
    say({ type: 'error', id: message.id, message: 'el motor no está iniciado' });
    return;
  }
  pending
    .then((recognize) =>
      recognize(message.audio, {
        task: 'transcribe',
        ...(language ? { language } : {}),
        // A decoding loop must not run for seconds: speech in 12 s is far below this.
        max_new_tokens: 128,
      }),
    )
    .then(
      (result) => {
        const first = Array.isArray(result) ? result[0] : result;
        say({ type: 'text', id: message.id, text: first?.text ?? '' });
      },
      (error: unknown) => say({ type: 'error', id: message.id, message: describeError(error) }),
    );
};
