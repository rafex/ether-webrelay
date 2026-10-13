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

export function parseInvite(pathname: string, search: string): InviteResult {
  const match = /(?:^|\/)join\/([^/]+)\/?$/.exec(pathname);
  if (!match?.[1]) return { ok: false, reason: 'missing-room' };
  let room: string;
  try {
    room = decodeURIComponent(match[1]);
  } catch {
    return { ok: false, reason: 'invalid-room' };
  }
  if (!ROOM_PATTERN.test(room)) return { ok: false, reason: 'invalid-room' };
  const token = new URLSearchParams(search).get('t')?.trim() ?? '';
  if (token === '' || token.length > MAX_TOKEN_LENGTH)
    return { ok: false, reason: 'missing-token' };
  return { ok: true, invite: { room, token } };
}

export const INVITE_ERRORS: Record<Exclude<InviteResult, { ok: true }>['reason'], string> = {
  'missing-room':
    'Este enlace no apunta a ninguna sala. Pide al anfitrión un enlace de invitación.',
  'invalid-room': 'El nombre de la sala del enlace no es válido.',
  'missing-token': 'Al enlace le falta el código de acceso. Pide al anfitrión un enlace completo.',
};
