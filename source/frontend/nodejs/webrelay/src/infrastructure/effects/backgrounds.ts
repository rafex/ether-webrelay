/**
 * Built-in virtual backgrounds, drawn with canvas gradients so the app ships
 * no image assets (and no third-party photos).
 */
type Painter = (ctx: CanvasRenderingContext2D, width: number, height: number) => void;

const PAINTERS: Record<string, Painter> = {
  aurora: (ctx, w, h) => {
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#071426');
    sky.addColorStop(1, '#10233f');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);
    for (const [x, color] of [
      [0.25, 'rgba(46, 230, 160, 0.45)'],
      [0.6, 'rgba(90, 120, 255, 0.4)'],
      [0.85, 'rgba(180, 90, 255, 0.3)'],
    ] as const) {
      const glow = ctx.createRadialGradient(w * x, h * 0.35, 0, w * x, h * 0.35, w * 0.45);
      glow.addColorStop(0, color);
      glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);
    }
  },
  sunset: (ctx, w, h) => {
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#2b1055');
    sky.addColorStop(0.55, '#d1495b');
    sky.addColorStop(1, '#f6ae2d');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);
    const sun = ctx.createRadialGradient(w * 0.7, h * 0.75, 0, w * 0.7, h * 0.75, h * 0.35);
    sun.addColorStop(0, 'rgba(255, 236, 179, 0.95)');
    sun.addColorStop(1, 'rgba(255, 236, 179, 0)');
    ctx.fillStyle = sun;
    ctx.fillRect(0, 0, w, h);
  },
  studio: (ctx, w, h) => {
    const wall = ctx.createRadialGradient(w / 2, h * 0.4, 0, w / 2, h * 0.4, w * 0.75);
    wall.addColorStop(0, '#3b3f4a');
    wall.addColorStop(1, '#14161b');
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
    for (let x = 0; x < w; x += Math.max(12, w / 24)) ctx.fillRect(x, 0, 1, h);
  },
};

export function hasPreset(id: string): boolean {
  return id in PAINTERS;
}

export function paintPreset(
  ctx: CanvasRenderingContext2D,
  id: string,
  width: number,
  height: number,
): void {
  (PAINTERS[id] ?? PAINTERS.studio)?.(ctx, width, height);
}

/** Small preview for the settings dialog. */
export function presetThumbnail(id: string): string {
  const canvas = document.createElement('canvas');
  canvas.width = 160;
  canvas.height = 90;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  paintPreset(ctx, id, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}
