import {
  DEFAULT_PREFERENCES,
  sanitizePreferences,
  type UserPreferences,
} from '../../domain/preferences';
import type { PreferencesPort } from '../../ports/preferences';

export const PREFERENCES_KEY = 'ether-webrelay.preferences.v1';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * PreferencesPort over localStorage. Storage can be missing or throw (private
 * windows, blocked site data): the app then simply forgets between visits.
 */
export class LocalPreferences implements PreferencesPort {
  constructor(private readonly storage: StorageLike | undefined = safeLocalStorage()) {}

  load(): UserPreferences {
    try {
      const raw = this.storage?.getItem(PREFERENCES_KEY);
      return raw ? sanitizePreferences(JSON.parse(raw)) : DEFAULT_PREFERENCES;
    } catch {
      return DEFAULT_PREFERENCES;
    }
  }

  save(preferences: UserPreferences): void {
    try {
      this.storage?.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
    } catch {
      // Quota exceeded or storage blocked: preferences are a convenience only.
    }
  }
}

function safeLocalStorage(): StorageLike | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}
