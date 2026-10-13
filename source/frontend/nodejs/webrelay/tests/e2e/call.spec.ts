import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { BRIDGE_PORT } from '../../playwright.config';

const CONFIG = {
  bridgeUrl: `ws://127.0.0.1:${BRIDGE_PORT}/signal`,
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
