/**
 * Canvas abstraction.
 *
 * Every procedural texture in the project (the globe skin, the wood grain)
 * draws through this narrow interface. jsdom has no 2D context, so without it
 * the drawing code would be untestable — and the drawing code is exactly where
 * subtle geometry bugs hide.
 */

export type FillStyle = string | CanvasPattern | CanvasGradient;

/** The subset of `CanvasRenderingContext2D` these modules use. */
export interface Canvas2D {
  fillStyle: FillStyle;
  strokeStyle: FillStyle;
  lineWidth: number;
  lineJoin: CanvasLineJoin;
  globalAlpha: number;
  save(): void;
  restore(): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
  fill(): void;
  stroke(): void;
  fillRect(x: number, y: number, width: number, height: number): void;
  createPattern(image: unknown, repetition: string): FillStyle | null;
}

export interface CanvasLike {
  width: number;
  height: number;
  getContext(contextId: '2d'): Canvas2D | null;
}

export type CanvasFactory = (width: number, height: number) => CanvasLike;

/**
 * Real DOM canvases.
 *
 * `HTMLCanvasElement` structurally satisfies `CanvasLike` already, so no cast is
 * needed — the narrow interface exists to describe what the drawing code may
 * use, not to hide the real type.
 */
export const domCanvasFactory: CanvasFactory = (width, height) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

/**
 * Deterministic PRNG (mulberry32).
 *
 * Determinism matters for textures: a random grain would make the globe look
 * slightly different on every launch, and would make visual regression
 * screenshots useless.
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
