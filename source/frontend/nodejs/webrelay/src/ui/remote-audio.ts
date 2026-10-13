import type { MediaTrackLike } from '../ports/media';
import { applySink, attachTrack } from './dom';

/** One hidden <audio> per remote audio track, routed to the chosen speaker. */
export class RemoteAudio {
  private readonly elements = new Map<string, HTMLAudioElement>();
  private sinkId: string | undefined;

  constructor(private readonly container: HTMLElement) {}

  sync(tracks: ReadonlyMap<string, MediaTrackLike>): void {
    for (const [key, element] of this.elements) {
      if (tracks.has(key)) continue;
      attachTrack(element, undefined);
      element.remove();
      this.elements.delete(key);
    }
    for (const [key, track] of tracks) {
      let element = this.elements.get(key);
      if (!element) {
        element = document.createElement('audio');
        element.autoplay = true;
        element.hidden = true;
        this.container.append(element);
        this.elements.set(key, element);
        void applySink(element, this.sinkId);
      }
      attachTrack(element, track);
    }
  }

  setSink(sinkId: string | undefined): void {
    this.sinkId = sinkId;
    for (const element of this.elements.values()) void applySink(element, sinkId);
  }

  clear(): void {
    this.sync(new Map());
  }
}
