import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { BRIDGE_URL, EXTERNAL_BRIDGE_URL } from '../../playwright.config';

const CONFIG = {
  bridgeUrl: BRIDGE_URL,
  transport: 'webrtc',
  defaultView: 'stage',
};

/**
 * Synthetic microphone: a 440 Hz tone from Web Audio replaces Chromium's fake
 * audio device, which hangs in some headless hosts (e.g. macOS without
 * CoreAudio access). Video keeps using --use-fake-device-for-media-stream.
 */
function syntheticMicrophone(): void {
  const devices = navigator.mediaDevices;
  const original = devices.getUserMedia.bind(devices);
  devices.getUserMedia = async (constraints?: MediaStreamConstraints) => {
    const stream = new MediaStream();
    if (constraints?.video) {
      for (const track of (await original({ video: constraints.video })).getTracks()) {
        stream.addTrack(track);
      }
    }
    if (constraints?.audio) {
      const context = new AudioContext();
      const oscillator = context.createOscillator();
      const destination = context.createMediaStreamDestination();
      oscillator.connect(destination);
      oscillator.start();
      for (const track of destination.stream.getAudioTracks()) stream.addTrack(track);
    }
    return stream;
  };
}

/** Each participant gets its own context (separate devices, storage and permissions). */
async function participant(context: BrowserContext): Promise<Page> {
  await context.grantPermissions(['camera', 'microphone']);
  const page = await context.newPage();
  await page.addInitScript(syntheticMicrophone);
  await page.route('**/config.json', (route) => route.fulfill({ json: CONFIG }));
  return page;
}

async function openLobby(page: Page, room: string, token = 'e2e'): Promise<void> {
  await page.goto(`/join/${room}?t=${token}`);
  await expect(page.locator('#room-title')).toHaveText(`Sala de pruebas · ${room}`);
}

async function join(page: Page, name: string): Promise<void> {
  await page.locator('#join-name').fill(name);
  await page.locator('#join-button').click();
  await expect(page.locator('#call-badge')).toHaveText('En la sala');
}

/** Width of the video currently shown in a tile (0 until frames arrive). */
function tileVideoWidth(page: Page, name: string) {
  return page
    .locator('.tile', { has: page.locator('.tile-name', { hasText: name }) })
    .locator('video')
    .evaluate((video: HTMLVideoElement) => video.videoWidth);
}

test.describe('lobby', () => {
  test('rejects links without a token', async ({ page }) => {
    await page.route('**/config.json', (route) => route.fulfill({ json: CONFIG }));
    await page.goto('/join/e2e');
    await expect(page.locator('[data-screen="invalid"]')).toBeVisible();
    await expect(page.locator('#invalid-message')).toContainText('código de acceso');
  });

  test('explains an invitation the bridge rejects', async ({ context }) => {
    const page = await participant(context);
    await page.goto('/join/e2e?t=invalid');
    await expect(page.locator('#lobby-status')).toHaveText(
      'El enlace de invitación no es válido o ha caducado.',
    );
    await expect(page.locator('#join-button')).toBeDisabled();
  });

  test('keeps the invitation token out of the address bar but survives a reload', async ({
    context,
    browser,
  }) => {
    const page = await participant(context);
    await openLobby(page, 'e2e-token', 'secret-token');
    // The token is a credential: it must not stay in the URL (history, bookmarks, shared screens).
    await expect.poll(() => new URL(page.url()).search).toBe('');
    expect(page.url()).not.toContain('secret-token');
    expect(new URL(page.url()).pathname).toBe('/join/e2e-token');

    // Reloading the tab re-reads it from sessionStorage.
    await page.reload();
    await expect(page.locator('#room-title')).toHaveText('Sala de pruebas · e2e-token');
    await expect.poll(() => new URL(page.url()).search).toBe('');

    // Another browser context has no memory of it: the plain link is not enough.
    const fresh = await browser.newContext();
    const other = await fresh.newPage();
    await other.route('**/config.json', (route) => route.fulfill({ json: CONFIG }));
    await other.goto(`${new URL(page.url()).origin}/join/e2e-token`);
    await expect(other.locator('[data-screen="invalid"]')).toBeVisible();
    await fresh.close();
  });

  test('shows the room, a live camera preview and the channels', async ({ context }) => {
    const page = await participant(context);
    await openLobby(page, 'e2e-lobby');
    await expect(page.locator('#host-name')).toHaveText('Anfitrión de pruebas');
    await expect(page.locator('#channel-list li')).toHaveCount(2);
    await expect
      .poll(() => page.locator('#lobby-preview').evaluate((v: HTMLVideoElement) => v.videoWidth))
      .toBeGreaterThan(0);
    await expect(page.locator('#lobby-preview')).toHaveClass(/mirror/);

    await page.locator('#lobby-cam').click();
    await expect(page.locator('#lobby-cam')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#lobby-preview-off')).toBeVisible();

    await page.locator('#lobby-settings').click();
    await expect(page.locator('#settings')).toBeVisible();
    await expect(page.locator('#set-resolution option')).toHaveCount(3);
    await page.keyboard.press('Escape');
    await expect(page.locator('#settings')).toBeHidden();
  });
});

/**
 * Waiting room. Against the dev bridge double, rooms named `wait-…` / `deny-…` mimic an
 * approval room whose host answers after a moment. Against a real bridge (E2E_BRIDGE_URL,
 * development mode, admin token `dev`) the test is the host: it creates the room with
 * `admission: approval` and admits or denies through the host API, which makes this a true
 * integration test of both repositories.
 */
const HOST_API = EXTERNAL_BRIDGE_URL
  ? `${EXTERNAL_BRIDGE_URL.replace(/^ws/, 'http').replace(/\/signal$/, '')}/api/v1`
  : undefined;

/** The parts of the host API's room view these tests read. */
interface RoomView {
  waiting: { id: string }[];
  participants: unknown[];
}

async function host(method: string, path: string, body?: unknown): Promise<RoomView> {
  const response = await fetch(`${HOST_API}${path}`, {
    method,
    headers: { Authorization: 'Bearer dev', 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  expect(response.ok, `${method} ${path} -> ${response.status}`).toBe(true);
  return (response.status === 204 ? undefined : await response.json()) as RoomView;
}

/** An approval room: created through the host API on a real bridge, by name on the double. */
async function approvalRoom(kind: 'wait' | 'deny'): Promise<string> {
  const id = `${kind}-${Date.now().toString(36)}`;
  if (HOST_API) {
    await host('POST', '/rooms', {
      id,
      title: `Sala de pruebas · ${id}`,
      host: { name: 'Anfitrión de pruebas' },
      admission: 'approval',
    });
  }
  return id;
}

/** The host's answer: automatic on the double, an API call on a real bridge. */
async function answer(room: string, verdict: 'admit' | 'deny'): Promise<void> {
  if (!HOST_API) return;
  let waiting: { id: string }[] = [];
  await expect
    .poll(async () => {
      waiting = (await host('GET', `/rooms/${room}`)).waiting;
      return waiting.length;
    })
    .toBe(1);
  await host('POST', `/rooms/${room}/waiting/${waiting[0]?.id}/${verdict}`);
}

test.describe('waiting room', () => {
  test('a guest waits for the host, then is admitted and joins', async ({ context }) => {
    const room = await approvalRoom('wait');
    const page = await participant(context);
    await openLobby(page, room);
    await page.locator('#join-name').fill('Ana');
    await page.locator('#join-button').click();
    await expect(page.locator('#call-badge')).toHaveText('Esperando admisión');
    if (HOST_API) {
      // Nobody answered yet: still no seat.
      expect((await host('GET', `/rooms/${room}`)).participants).toHaveLength(0);
    }
    await answer(room, 'admit');
    await expect(page.locator('#call-badge')).toHaveText('En la sala');
    if (HOST_API) expect((await host('GET', `/rooms/${room}`)).participants).toHaveLength(1);
  });

  test('a guest the host turns away sees why', async ({ context }) => {
    const room = await approvalRoom('deny');
    const page = await participant(context);
    await openLobby(page, room);
    await page.locator('#join-name').fill('Ana');
    await page.locator('#join-button').click();
    await expect(page.locator('#call-badge')).toHaveText('Esperando admisión');
    await answer(room, 'deny');
    await expect(page.locator('[data-screen="left"]')).toBeVisible();
    await expect(page.locator('#left-message')).toContainText('no te ha admitido');
    if (HOST_API) expect((await host('GET', `/rooms/${room}`)).participants).toHaveLength(0);
  });
});

test.describe('call', () => {
  test('two participants see and hear each other through the bridge', async ({ browser }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const ana = await participant(contextA);
    const beto = await participant(contextB);

    await openLobby(ana, 'e2e-call');
    await join(ana, 'Ana');
    await openLobby(beto, 'e2e-call');
    await join(beto, 'Beto');

    // Presence on both sides.
    await expect(ana.locator('.tile-name', { hasText: 'Beto' })).toBeVisible();
    await expect(beto.locator('.tile-name', { hasText: 'Ana' })).toBeVisible();

    // Real media relayed by the SFU: remote video decodes and remote audio is attached.
    await expect.poll(() => tileVideoWidth(ana, 'Beto'), { timeout: 20_000 }).toBeGreaterThan(0);
    await expect.poll(() => tileVideoWidth(beto, 'Ana'), { timeout: 20_000 }).toBeGreaterThan(0);
    await expect.poll(() => ana.locator('#call audio').count()).toBeGreaterThan(0);

    // Muting propagates as a participant update.
    await beto.locator('#call-mic').click();
    await expect(
      ana.locator('.tile', { has: ana.locator('.tile-name', { hasText: 'Beto' }) }),
    ).toHaveClass(/muted/);

    // Views switch live; stats show real traffic.
    await ana.locator('#call-view').click();
    await ana.locator('[data-view-option="stats"]').click();
    await expect(ana.locator('#stats-panel')).toBeVisible();
    await expect(ana.locator('[data-stat="participants"]')).toHaveText('2');
    await expect
      .poll(() => ana.locator('[data-stat="downloadBps"]').textContent(), { timeout: 10_000 })
      .toMatch(/kbps|Mbps/);
    await ana.keyboard.press('l');
    await expect(ana.locator('#call')).toHaveAttribute('data-view', 'stage');

    // Leaving removes the tile on the other side.
    await beto.locator('#call-leave').click();
    await expect(beto.locator('[data-screen="left"]')).toBeVisible();
    await expect(ana.locator('.tile-name', { hasText: 'Beto' })).toHaveCount(0);

    await contextA.close();
    await contextB.close();
  });

  test('a screen share takes the spotlight for everyone', async ({ browser }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const ana = await participant(contextA);
    const beto = await participant(contextB);
    await openLobby(ana, 'e2e-share');
    await join(ana, 'Ana');
    await openLobby(beto, 'e2e-share');
    await join(beto, 'Beto');

    await beto.locator('#call-screen').click();
    await expect(beto.locator('#call-screen')).toHaveAttribute('aria-pressed', 'true');
    await expect(beto.locator('.tile.spotlight')).toBeVisible();
    await expect(ana.locator('.tile.spotlight .tile-name')).toHaveText('Pantalla de Beto', {
      timeout: 20_000,
    });
    await expect
      .poll(() => tileVideoWidth(ana, 'Pantalla de Beto'), { timeout: 20_000 })
      .toBeGreaterThan(0);

    await beto.locator('#call-screen').click();
    await expect(ana.locator('.tile.spotlight')).toHaveCount(0);
    await contextA.close();
    await contextB.close();
  });
});
