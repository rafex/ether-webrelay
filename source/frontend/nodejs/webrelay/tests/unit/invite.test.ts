import { describe, expect, it } from 'vitest';
import { parseInvite, resolveInvite } from '../../src/domain/invite';
import {
  INVITE_KEY_PREFIX,
  SessionInviteMemory,
} from '../../src/infrastructure/storage/session-invite';

const none = () => undefined;

describe('resolveInvite', () => {
  it('reads the token from the link', () => {
    expect(resolveInvite('/join/demo', '?t=abc', none)).toEqual({
      ok: true,
      invite: { room: 'demo', token: 'abc' },
    });
  });

  it('lets the token in the URL win over a remembered one', () => {
    const recall = () => 'old';
    expect(resolveInvite('/join/demo', '?t=new', recall)).toMatchObject({
      invite: { token: 'new' },
    });
  });

  it('falls back to the token remembered for that room after it left the URL', () => {
    const recall = (room: string) => (room === 'demo' ? 'remembered' : undefined);
    expect(resolveInvite('/join/demo', '', recall)).toEqual({
      ok: true,
      invite: { room: 'demo', token: 'remembered' },
    });
    expect(resolveInvite('/join/other', '', recall)).toEqual({
      ok: false,
      reason: 'missing-token',
    });
  });

  it('does not use a remembered token for a link that is invalid anyway', () => {
    const recall = () => 'remembered';
    expect(resolveInvite('/nope', '', recall)).toEqual({ ok: false, reason: 'missing-room' });
    expect(resolveInvite('/join/bad room!', '', recall)).toEqual({
      ok: false,
      reason: 'invalid-room',
    });
  });

  it('ignores an empty or oversized remembered token', () => {
    expect(resolveInvite('/join/demo', '', () => '  ')).toMatchObject({ ok: false });
    expect(resolveInvite('/join/demo', '', () => 'x'.repeat(9000))).toMatchObject({ ok: false });
  });

  it('parseInvite itself still needs the token in the URL', () => {
    expect(parseInvite('/join/demo', '')).toEqual({ ok: false, reason: 'missing-token' });
  });
});

describe('SessionInviteMemory', () => {
  function fakeStorage(options: { failWrite?: boolean; drop?: boolean } = {}) {
    const data = new Map<string, string>();
    return {
      data,
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (options.failWrite) throw new Error('blocked');
        if (!options.drop) data.set(key, value);
      },
    };
  }

  it('remembers a token per room, in the tab only', () => {
    const storage = fakeStorage();
    const memory = new SessionInviteMemory(storage);
    expect(memory.remember({ room: 'demo', token: 't1' })).toBe(true);
    expect(storage.data.get(`${INVITE_KEY_PREFIX}demo`)).toBe('t1');
    expect(memory.recall('demo')).toBe('t1');
    expect(memory.recall('other')).toBeUndefined();
  });

  it('reports failure when storage throws, is missing or silently drops the write', () => {
    const invite = { room: 'demo', token: 't1' };
    expect(new SessionInviteMemory(fakeStorage({ failWrite: true })).remember(invite)).toBe(false);
    expect(new SessionInviteMemory(fakeStorage({ drop: true })).remember(invite)).toBe(false);
    const missing = new SessionInviteMemory(null);
    expect(missing.remember(invite)).toBe(false);
    expect(missing.recall('demo')).toBeUndefined();
  });
});
