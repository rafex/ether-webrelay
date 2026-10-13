/**
 * Fixed-rate ticks from a dedicated worker. Main-thread timers and rAF are
 * throttled in hidden tabs — common while sharing a screen — workers are not.
 */
export interface Ticker {
  stop(): void;
}

const SOURCE =
  'let id;onmessage=(e)=>{clearInterval(id);if(e.data>0)id=setInterval(()=>postMessage(0),e.data)}';

export function startWorkerTicker(framerate: number, onTick: () => void): Ticker {
  const url = URL.createObjectURL(new Blob([SOURCE], { type: 'text/javascript' }));
  const worker = new Worker(url);
  worker.onmessage = onTick;
  worker.postMessage(1000 / framerate);
  return {
    stop() {
      worker.postMessage(0);
      worker.terminate();
      URL.revokeObjectURL(url);
    },
  };
}
