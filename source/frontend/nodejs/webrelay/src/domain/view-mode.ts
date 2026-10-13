/** In-call layouts the participant can switch between at any time. */
export type ViewMode = 'stage' | 'minimal' | 'stats';

export const VIEW_MODES: readonly ViewMode[] = ['stage', 'minimal', 'stats'];

export const VIEW_MODE_LABELS: Record<ViewMode, string> = {
  stage: 'Escenario',
  minimal: 'Mínima',
  stats: 'Escenario + estadísticas',
};

export function isViewMode(value: unknown): value is ViewMode {
  return typeof value === 'string' && (VIEW_MODES as readonly string[]).includes(value);
}

export function nextViewMode(current: ViewMode): ViewMode {
  return VIEW_MODES[(VIEW_MODES.indexOf(current) + 1) % VIEW_MODES.length] ?? 'stage';
}
