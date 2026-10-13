export type ShortcutAction =
  | 'toggle-microphone'
  | 'toggle-camera'
  | 'toggle-screen'
  | 'cycle-view'
  | 'open-settings';

export interface Shortcut {
  readonly key: string;
  readonly action: ShortcutAction;
  readonly label: string;
}

export const SHORTCUTS: readonly Shortcut[] = [
  { key: 'm', action: 'toggle-microphone', label: 'Activar o silenciar el micrófono' },
  { key: 'v', action: 'toggle-camera', label: 'Encender o apagar la cámara' },
  { key: 's', action: 'toggle-screen', label: 'Compartir o dejar de compartir pantalla' },
  { key: 'l', action: 'cycle-view', label: 'Cambiar de vista' },
  { key: ',', action: 'open-settings', label: 'Abrir ajustes' },
];

export interface KeyInput {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  /** The event target is a text field: typing must never trigger shortcuts. */
  readonly editableTarget: boolean;
}

export function resolveShortcut(input: KeyInput): ShortcutAction | undefined {
  if (input.editableTarget || input.ctrlKey || input.metaKey || input.altKey) return undefined;
  const key = input.key.toLowerCase();
  return SHORTCUTS.find((shortcut) => shortcut.key === key)?.action;
}
