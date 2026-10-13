export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type OverlayCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export interface OverlayOptions {
  readonly corner: OverlayCorner;
  /** Overlay width as a fraction of the canvas width. */
  readonly scale: number;
  /** Margin as a fraction of the canvas width. */
  readonly margin: number;
}

export const DEFAULT_OVERLAY: OverlayOptions = {
  corner: 'bottom-right',
  scale: 0.25,
  margin: 0.02,
};

/** Largest rect with the source aspect ratio that fits (letterboxed) inside the target. */
export function fitContain(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): Rect {
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return { x: 0, y: 0, width: targetWidth, height: targetHeight };
  }
  const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const width = Math.round(sourceWidth * scale);
  const height = Math.round(sourceHeight * scale);
  return {
    x: Math.round((targetWidth - width) / 2),
    y: Math.round((targetHeight - height) / 2),
    width,
    height,
  };
}

/** Picture-in-picture rect for the camera on top of the screen share. */
export function overlayRect(
  canvasWidth: number,
  canvasHeight: number,
  sourceWidth: number,
  sourceHeight: number,
  options: OverlayOptions = DEFAULT_OVERLAY,
): Rect {
  const aspect = sourceWidth > 0 && sourceHeight > 0 ? sourceHeight / sourceWidth : 9 / 16;
  const width = Math.round(canvasWidth * options.scale);
  const height = Math.round(width * aspect);
  const margin = Math.round(canvasWidth * options.margin);
  const left = options.corner.endsWith('left');
  const top = options.corner.startsWith('top');
  return {
    x: left ? margin : canvasWidth - width - margin,
    y: top ? margin : canvasHeight - height - margin,
    width,
    height,
  };
}
