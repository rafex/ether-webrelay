import type { UserPreferences } from '../domain/preferences';

/** Driven port: per-browser persistence of the participant's choices. */
export interface PreferencesPort {
  load(): UserPreferences;
  save(preferences: UserPreferences): void;
}
