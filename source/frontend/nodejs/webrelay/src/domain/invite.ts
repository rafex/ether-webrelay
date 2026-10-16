/**
 * Invitation links: `/join/<room>?t=<token>`. The organiser (via the bridge)
 * issues the link; the guest never types a bridge URL or credentials.
 */
export interface Invite {
  readonly room: string;
  readonly token: string;
}

export type InviteResult =
  | { readonly ok: true; readonly invite: Invite }
  | { readonly ok: false; readonly reason: 'missing-room' | 'invalid-room' | 'missing-token' };

const ROOM_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MAX_TOKEN_LENGTH = 8192;

type RoomResult =
  | { readonly ok: true; readonly room: string }
  | { readonly ok: false; readonly reason: 'missing-room' | 'invalid-room' };

function parseRoom(pathname: string): RoomResult {
  const match = /(?:^|\/)join\/([^/]+)\/?$/.exec(pathname);
  if (!match?.[1]) return { ok: false, reason: 'missing-room' };
  let room: string;
  try {
    room = decodeURIComponent(match[1]);
  } catch {
    return { ok: false, reason: 'invalid-room' };
  }
  if (!ROOM_PATTERN.test(room)) return { ok: false, reason: 'invalid-room' };
  return { ok: true, room };
}

function usableToken(token: string | null | undefined): string {
  const trimmed = token?.trim() ?? '';
  return trimmed === '' || trimmed.length > MAX_TOKEN_LENGTH ? '' : trimmed;
}

export function parseInvite(pathname: string, search: string): InviteResult {
  const room = parseRoom(pathname);
  if (!room.ok) return room;
  const token = usableToken(new URLSearchParams(search).get('t'));
  if (token === '') return { ok: false, reason: 'missing-token' };
  return { ok: true, invite: { room: room.room, token } };
}

/**
 * Like parseInvite, but a link whose token already left the address bar (the
 * app removes it after reading it) falls back to the token remembered for the
 * room in this tab, so reloading keeps working. A token in the URL always wins.
 */
export function resolveInvite(
  pathname: string,
  search: string,
  recall: (room: string) => string | undefined,
): InviteResult {
  const parsed = parseInvite(pathname, search);
  if (parsed.ok || parsed.reason !== 'missing-token') return parsed;
  const room = parseRoom(pathname);
  if (!room.ok) return room;
  const token = usableToken(recall(room.room));
  return token === '' ? parsed : { ok: true, invite: { room: room.room, token } };
}

export const INVITE_ERRORS: Record<Exclude<InviteResult, { ok: true }>['reason'], string> = {
  'missing-room':
    'Este enlace no apunta a ninguna sala. Pide al anfitrión un enlace de invitación.',
  'invalid-room': 'El nombre de la sala del enlace no es válido.',
  'missing-token': 'Al enlace le falta el código de acceso. Pide al anfitrión un enlace completo.',
};
