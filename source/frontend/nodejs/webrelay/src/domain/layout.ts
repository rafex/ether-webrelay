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

/**
 * Mosaic for N tiles: columns = ceil(sqrt(N)); every cell keeps 16:9 and the
 * grid is centred. Used by the stage and by the call recorder.
 */
export function gridLayout(count: number, width: number, height: number, gap = 8): Rect[] {
  if (count <= 0) return [];
  const columns = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns);
  const cellWidth = (width - gap * (columns + 1)) / columns;
  const cellHeight = (height - gap * (rows + 1)) / rows;
  const tile = fitContain(16, 9, cellWidth, cellHeight);
  const usedWidth = columns * tile.width + (columns - 1) * gap;
  const usedHeight = rows * tile.height + (rows - 1) * gap;
  const left = (width - usedWidth) / 2;
  const top = (height - usedHeight) / 2;
  return Array.from({ length: count }, (_, i) => {
    const row = Math.floor(i / columns);
    const inRow = row === rows - 1 ? count - row * columns : columns;
    // Centre an incomplete last row.
    const rowOffset = ((columns - inRow) * (tile.width + gap)) / 2;
    return {
      x: Math.round(left + rowOffset + (i % columns) * (tile.width + gap)),
      y: Math.round(top + row * (tile.height + gap)),
      width: tile.width,
      height: tile.height,
    };
  });
}

/** Screen share on the left (3/4 width) and participant thumbnails stacked on the right. */
export function spotlightLayout(
  thumbnails: number,
  width: number,
  height: number,
  gap = 8,
): { readonly main: Rect; readonly thumbnails: Rect[] } {
  if (thumbnails <= 0) {
    return { main: { x: 0, y: 0, width, height }, thumbnails: [] };
  }
  const sideWidth = Math.round(width / 4);
  const main = fitContain(16, 9, width - sideWidth - gap, height);
  const thumbHeight = Math.min(
    Math.round((sideWidth * 9) / 16),
    (height - gap * (thumbnails - 1)) / thumbnails,
  );
  const thumbWidth = Math.round((thumbHeight * 16) / 9);
  return {
    main,
    thumbnails: Array.from({ length: thumbnails }, (_, i) => ({
      x: width - sideWidth + Math.round((sideWidth - thumbWidth) / 2),
      y: Math.round(i * (thumbHeight + gap)),
      width: thumbWidth,
      height: Math.round(thumbHeight),
    })),
  };
}
