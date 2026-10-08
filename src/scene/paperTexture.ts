/**
 * Procedural globe skin.
 *
 * The globe's surface is drawn from public-domain vector data rather than a
 * copyrighted map image (see ADR-0003). That buys three things: zero licence
 * risk, total control over the look, and the ability to retune the palette
 * without sourcing new art.
 *
 * The drawing target is a plain equirectangular image, because that is exactly
 * what a `SphereGeometry`'s UV mapping expects.
 *
 * The canvas is abstracted behind `CanvasLike` so the drawing logic is unit
 * testable with a recording fake — jsdom has no 2D context.
 */

import { graticuleValues, projectEquirectangular } from './geo/projection';
import type { LinearRing, PolygonRings } from './geo/land';
import {
  domCanvasFactory,
  mulberry32,
  type Canvas2D,
  type CanvasFactory,
  type CanvasLike,
  type FillStyle,
} from './canvas';

export const PAPER_TEXTURE_WIDTH = 4096;
export const PAPER_TEXTURE_HEIGHT = 2048;

export interface PaperPalette {
  /** Ocean / background of the printed map. */
  paper: string;
  /** Land fill. */
  land: string;
  /** The thin darker rim just inside the coastline. */
  landEdge: string;
  /** Coastline ink. */
  coast: string;
  /** Latitude / longitude lines. */
  graticule: string;
}

export interface PaperTextureOptions {
  width: number;
  height: number;
  palette: PaperPalette;
  /** Degrees between graticule lines. */
  graticuleStep: number;
  /**
   * Graticule line width in texture pixels.
   *
   * Needs to be several pixels, not one: the visible hemisphere uses roughly a
   * quarter of a 4096px texture, so a 1px line lands under a pixel on screen and
   * mipmapping averages it out of existence entirely.
   */
  graticuleWidth: number;
  coastlineWidth: number;
  noise: {
    tileSize: number;
    dots: number;
    seed: number;
  };
}

/**
 * Warm, low-contrast, matte. Per `docs/VISUAL.md`: the target is a still-life
 * photograph of a printed globe, not a satellite view.
 *
 * Land/ocean contrast is deliberately larger than it looks in source: the first
 * render showed a white ball with continents legible only from the coastline
 * ink, because tone mapping plus the key light flattened a subtle fill
 * difference away. Land must read as *printed*, so it is a clear step darker
 * than the paper.
 */
export const DEFAULT_PAPER_OPTIONS: PaperTextureOptions = {
  width: PAPER_TEXTURE_WIDTH,
  height: PAPER_TEXTURE_HEIGHT,
  palette: {
    paper: '#e2d6be',
    land: '#c6b28c',
    landEdge: '#a58f68',
    coast: '#433b31',
    graticule: 'rgba(67, 59, 49, 0.34)',
  },
  graticuleStep: 15,
  graticuleWidth: 3,
  coastlineWidth: 1.8,
  noise: {
    tileSize: 256,
    dots: 2600,
    seed: 0x5eed,
  },
};

/**
 * Trace a ring into the current path.
 *
 * A ring that crosses the antimeridian would otherwise be stroked as a straight
 * line back across the entire texture. We detect the wrap (a longitude jump over
 * 180°) and restart the subpath instead — and skip `closePath` when that
 * happens, because closing would draw exactly the artefact we just avoided.
 */
export function traceRing(ctx: Canvas2D, ring: LinearRing, width: number, height: number): void {
  let previousLng: number | null = null;
  let started = false;
  let broke = false;

  for (const position of ring) {
    const lng = position[0];
    const lat = position[1];
    if (typeof lng !== 'number' || typeof lat !== 'number') continue;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;

    const point = projectEquirectangular(lng, lat, width, height);
    const wrapped = previousLng !== null && Math.abs(lng - previousLng) > 180;

    if (!started || wrapped) {
      ctx.moveTo(point.x, point.y);
      started = true;
      if (wrapped) broke = true;
    } else {
      ctx.lineTo(point.x, point.y);
    }

    previousLng = lng;
  }

  if (!broke) ctx.closePath();
}

/** A tiling paper-grain pattern, or `null` when a pattern cannot be built. */
export function createNoisePattern(
  ctx: Canvas2D,
  factory: CanvasFactory,
  noise: PaperTextureOptions['noise'],
): FillStyle | null {
  const tile = factory(noise.tileSize, noise.tileSize);
  const tileCtx = tile.getContext('2d');
  if (!tileCtx) return null;

  const random = mulberry32(noise.seed);
  tileCtx.fillStyle = '#000000';

  for (let index = 0; index < noise.dots; index += 1) {
    const x = random() * noise.tileSize;
    const y = random() * noise.tileSize;
    const size = 0.5 + random() * 1.6;
    tileCtx.globalAlpha = 0.015 + random() * 0.05;
    tileCtx.fillRect(x, y, size, size);
  }
  tileCtx.globalAlpha = 1;

  return ctx.createPattern(tile, 'repeat');
}

/** Draw the whole map onto an already-sized 2D context. */
export function drawPaperMap(
  ctx: Canvas2D,
  polygons: readonly PolygonRings[],
  options: PaperTextureOptions,
  factory: CanvasFactory,
): void {
  const { width, height, palette } = options;

  ctx.save();

  // 1. Paper base.
  ctx.fillStyle = palette.paper;
  ctx.fillRect(0, 0, width, height);

  // 2. Grain, so the surface reads as paper rather than flat vector fill.
  const noise = createNoisePattern(ctx, factory, options.noise);
  if (noise) {
    ctx.fillStyle = noise;
    ctx.fillRect(0, 0, width, height);
  }

  // 3. Graticule under the land, so it only shows over the ocean — the way a
  //    printed globe looks.
  const graticule = graticuleValues(options.graticuleStep);
  ctx.strokeStyle = palette.graticule;
  ctx.lineWidth = options.graticuleWidth;
  ctx.beginPath();
  for (const lng of graticule.meridians) {
    const top = projectEquirectangular(lng, 90, width, height);
    const bottom = projectEquirectangular(lng, -90, width, height);
    ctx.moveTo(top.x, top.y);
    ctx.lineTo(bottom.x, bottom.y);
  }
  for (const lat of graticule.parallels) {
    const left = projectEquirectangular(-180, lat, width, height);
    const right = projectEquirectangular(180, lat, width, height);
    ctx.moveTo(left.x, left.y);
    ctx.lineTo(right.x, right.y);
  }
  ctx.stroke();

  // 4. Land fill.
  ctx.fillStyle = palette.land;
  ctx.beginPath();
  for (const polygon of polygons) {
    for (const ring of polygon) {
      traceRing(ctx, ring, width, height);
    }
  }
  ctx.fill();

  // 5. A darker rim, then the ink coastline. Two strokes give the land a slight
  //    lift without a drop shadow.
  ctx.lineJoin = 'round';
  ctx.strokeStyle = palette.landEdge;
  ctx.lineWidth = options.coastlineWidth * 2.4;
  ctx.stroke();

  ctx.strokeStyle = palette.coast;
  ctx.lineWidth = options.coastlineWidth;
  ctx.stroke();

  ctx.restore();
}

/**
 * Overrides for `createPaperTexture`.
 *
 * Nested groups are partial too — `Partial<PaperTextureOptions>` alone would
 * still require a caller to restate every field of `noise` just to change one.
 */
export interface PaperTextureOverrides {
  width?: number;
  height?: number;
  palette?: Partial<PaperPalette>;
  graticuleStep?: number;
  graticuleWidth?: number;
  coastlineWidth?: number;
  noise?: Partial<PaperTextureOptions['noise']>;
}

/**
 * Build the globe skin.
 *
 * `width`/`height` are clamped to at least 2 because a canvas of 0 or 1 pixel
 * silently yields an unusable texture, and the failure shows up much later as a
 * black sphere.
 */
export function createPaperTexture(
  polygons: readonly PolygonRings[],
  options: PaperTextureOverrides = {},
  factory: CanvasFactory = domCanvasFactory,
): CanvasLike {
  const resolved: PaperTextureOptions = {
    ...DEFAULT_PAPER_OPTIONS,
    ...options,
    palette: { ...DEFAULT_PAPER_OPTIONS.palette, ...options.palette },
    noise: { ...DEFAULT_PAPER_OPTIONS.noise, ...options.noise },
  };

  const width = Math.max(2, Math.round(resolved.width));
  const height = Math.max(2, Math.round(resolved.height));
  const canvas = factory(width, height);

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not acquire a 2D context for the globe texture');
  }

  drawPaperMap(ctx, polygons, { ...resolved, width, height }, factory);
  return canvas;
}
