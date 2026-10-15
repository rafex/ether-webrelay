import type { Invite } from '../../domain/invite';

export const INVITE_KEY_PREFIX = 'ether-webrelay.invite.';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * Remembers the invitation token of a room for this tab only (sessionStorage:
 * gone when the tab closes), so the token can leave the address bar, the
 * history and a shared screen without breaking a reload. Storage can be
 * missing or throw (private windows, blocked site data): `remember` then
 * reports false and the caller keeps the token in the URL.
 */
export class SessionInviteMemory {
  constructor(private readonly storage: StorageLike | null = safeSessionStorage()) {}

  remember(invite: Invite): boolean {
    try {
      if (!this.storage) return false;
      this.storage.setItem(INVITE_KEY_PREFIX + invite.room, invite.token);
      return this.storage.getItem(INVITE_KEY_PREFIX + invite.room) === invite.token;
    } catch {
      return false;
    }
  }

  recall(room: string): string | undefined {
    try {
      return this.storage?.getItem(INVITE_KEY_PREFIX + room) ?? undefined;
    } catch {
      return undefined;
    }
  }
}

function safeSessionStorage(): StorageLike | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}
