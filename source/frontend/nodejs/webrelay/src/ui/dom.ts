import type { MediaTrackLike } from '../ports/media';

export type ScreenName = 'loading' | 'invalid' | 'lobby' | 'call' | 'left';

export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`missing element #${id}`);
  return element as T;
}

export function showScreen(name: ScreenName): void {
  for (const screen of document.querySelectorAll<HTMLElement>('[data-screen]')) {
    screen.hidden = screen.dataset.screen !== name;
  }
}

export function setPressed(button: HTMLElement, pressed: boolean): void {
  button.setAttribute('aria-pressed', String(pressed));
}

export function cloneTemplate<T extends Element>(id: string): T {
  const template = byId<HTMLTemplateElement>(id);
  const node = template.content.firstElementChild?.cloneNode(true);
  if (!node) throw new Error(`empty template #${id}`);
  return node as T;
}

const attached = new WeakMap<HTMLMediaElement, MediaTrackLike | undefined>();

/** Shows `track` in a media element, touching srcObject only when it changes. */
export function attachTrack(element: HTMLMediaElement, track: MediaTrackLike | undefined): void {
  if (attached.get(element) === track) return;
  attached.set(element, track);
  element.srcObject = track ? new MediaStream([track as MediaStreamTrack]) : null;
  if (track) void element.play().catch(() => undefined);
}

export function toast(message: string, durationMs = 4_000): void {
  const region = document.getElementById('toasts');
  if (!region) return;
  const node = cloneTemplate<HTMLElement>('tpl-toast');
  const text = node.querySelector('.toast-text');
  if (text) text.textContent = message;
  region.append(node);
  setTimeout(() => node.remove(), durationMs);
}

export function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

/** Whether HTMLMediaElement.setSinkId (speaker selection) is available. */
export function canSelectSpeaker(): boolean {
  return 'setSinkId' in HTMLMediaElement.prototype;
}

export async function applySink(
  element: HTMLMediaElement,
  sinkId: string | undefined,
): Promise<void> {
  if (!canSelectSpeaker()) return;
  const media = element as HTMLMediaElement & { setSinkId(id: string): Promise<void> };
  await media.setSinkId(sinkId ?? '').catch(() => undefined);
}
