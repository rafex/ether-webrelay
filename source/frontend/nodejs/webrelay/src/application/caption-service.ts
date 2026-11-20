import type { MediaTrackLike } from '../ports/media';
import type { TranscriberPort, TranscriptionSession } from '../ports/transcriber';
import type { CallController } from './call-controller';

export interface CaptionDeps {
  readonly call: CallController;
  readonly transcriber: TranscriberPort;
  /** The guest's own choice (settings); read again on every change. */
  readonly enabled: () => boolean;
}

/** One line per this many ms at most, however fast the engine refines it. */
export const MIN_CAPTION_INTERVAL_MS = 150;
/** After the engine fails to start, wait this long before trying again (unless the guest changes something). */
export const RETRY_AFTER_FAILURE_MS = 30_000;

/**
 * Live captions of the guest's own voice. It decides when to listen: the guest opted in, the host
 * turned captions on for the room, we have a seat, and the microphone is live and not muted. Then
 * it feeds the engine's lines to the call. Any failure of the engine leaves the call untouched.
 * `evaluate()` re-checks the conditions; the service also re-checks on every call snapshot.
 */
export class CaptionService {
  private session: TranscriptionSession | undefined;
  private starting = false;
  private track: MediaTrackLike | undefined;
  private lastSent = '';
  private lastSentAt = -Infinity;
  private pending: { timer: ReturnType<typeof setTimeout>; text: string } | undefined;
  private failure = '';
  private retryAt = 0;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly deps: CaptionDeps,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.unsubscribe = deps.call.subscribe(() => this.evaluate());
    this.evaluate();
  }

  /** Why the engine could not start, for the settings ('' if it is fine). */
  get status(): string {
    return this.failure;
  }

  get running(): boolean {
    return this.session !== undefined;
  }

  dispose(): void {
    this.unsubscribe();
    this.stopSession();
  }

  evaluate(): void {
    const wanted = this.wanted();
    if (!wanted) {
      this.retryAt = 0; // a change of conditions earns a fresh attempt
      this.stopSession();
      return;
    }
    if (this.session && this.track === wanted) return; // already listening to this microphone
    if (this.starting || this.now() < this.retryAt) return;
    this.stopSession();
    this.starting = true;
    this.track = wanted;
    this.deps.transcriber
      .start(wanted, (text) => this.onLine(text))
      .then(
        (session) => {
          this.starting = false;
          // The conditions may have changed while the engine was loading.
          if (this.wanted() !== wanted) {
            session.stop();
            this.evaluate();
            return;
          }
          this.failure = '';
          this.session = session;
        },
        (error: unknown) => {
          this.starting = false;
          this.track = undefined;
          this.failure = `Los subtítulos no están disponibles: ${(error as Error).message}`;
          this.retryAt = this.now() + RETRY_AFTER_FAILURE_MS;
        },
      );
  }

  /** The microphone to listen to, or undefined when captions should be off. */
  private wanted(): MediaTrackLike | undefined {
    const { call, transcriber, enabled } = this.deps;
    if (!transcriber.available || !enabled()) return undefined;
    const snapshot = call.snapshot;
    if (!snapshot.captions || snapshot.state !== 'connected' || snapshot.self.muted)
      return undefined;
    const microphone = snapshot.local.microphone;
    return microphone && microphone.readyState === 'live' ? microphone : undefined;
  }

  private onLine(raw: string): void {
    const text = raw.trim();
    if (text === this.lastSent && !this.pending) return;
    const elapsed = this.now() - this.lastSentAt;
    if (text === '' || elapsed >= MIN_CAPTION_INTERVAL_MS) {
      this.send(text);
      return;
    }
    // Too soon: keep only the newest line and send it when the interval is over.
    if (this.pending) this.pending.text = text;
    else {
      this.pending = {
        text,
        timer: setTimeout(() => {
          const line = this.pending?.text ?? '';
          this.pending = undefined;
          this.send(line);
        }, MIN_CAPTION_INTERVAL_MS - elapsed),
      };
    }
  }

  private send(text: string): void {
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending = undefined;
    }
    this.lastSent = text;
    this.lastSentAt = this.now();
    this.deps.call.sendCaption(text);
  }

  private stopSession(): void {
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending = undefined;
    }
    if (this.session) {
      this.session.stop();
      this.session = undefined;
      this.track = undefined;
      // Whatever was on screen goes away with the voice.
      if (this.lastSent !== '') this.send('');
    }
  }
}
