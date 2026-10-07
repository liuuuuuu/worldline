/**
 * Materials and the procedural wood grain.
 *
 * No image files. The wood is drawn from a seeded PRNG so the desk looks
 * identical on every launch — which is what makes visual regression screenshots
 * meaningful.
 *
 * Palette follows `docs/VISUAL.md`: warm, matte, low saturation. The brass is
 * the single metallic highlight in the whole scene, so it is the only material
 * with `metalness: 1`.
 */

import * as THREE from 'three';
import {
  domCanvasFactory,
  mulberry32,
  type Canvas2D,
  type CanvasFactory,
  type CanvasLike,
} from './canvas';

export interface WoodOptions {
  width: number;
  height: number;
  /** Dominant surface colour. */
  base: string;
  /** Lighter grain streaks. */
  grain: string;
  /** Darker grain streaks and speckle. */
  dark: string;
  seed: number;
  /** Number of grain streaks across the width. */
  lines: number;
}

export const DEFAULT_WOOD_OPTIONS: WoodOptions = {
  width: 1024,
  height: 1024,
  // Lighter than a "walnut" swatch on purpose: the desk sits mostly in shadow
  // under a single key light, and a dark base colour reads as black.
  base: '#6a4f3a',
  grain: '#8a6a4e',
  dark: '#3d2c1f',
  seed: 0x3d2c,
  lines: 220,
};

/** Straight, slightly wavy grain — a desk, not a log. */
export function drawWood(ctx: Canvas2D, options: WoodOptions): void {
  const { width, height } = options;

  ctx.save();

  ctx.fillStyle = options.base;
  ctx.fillRect(0, 0, width, height);

  const random = mulberry32(options.seed);
  const lines = Math.max(1, Math.round(options.lines));
  ctx.lineJoin = 'round';

  for (let index = 0; index < lines; index += 1) {
    const baseX = (index / lines) * width;
    const amplitude = 2 + random() * 9;
    const phase = random() * Math.PI * 2;
    const frequency = 0.6 + random() * 1.8;
    const isDark = random() < 0.28;

    ctx.globalAlpha = 0.03 + random() * 0.12;
    ctx.strokeStyle = isDark ? options.dark : options.grain;
    ctx.lineWidth = 0.6 + random() * 2.6;

    ctx.beginPath();
    for (let y = 0; y <= height; y += 4) {
      const x = baseX + Math.sin((y / height) * Math.PI * 2 * frequency + phase) * amplitude;
      if (y === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  }

  // Fine speckle, so the surface does not read as flat vector stripes.
  ctx.fillStyle = options.dark;
  for (let index = 0; index < 1800; index += 1) {
    ctx.globalAlpha = 0.01 + random() * 0.05;
    ctx.fillRect(random() * width, random() * height, 1 + random() * 2, 1);
  }

  ctx.globalAlpha = 1;
  ctx.restore();
}

export function createWoodTexture(
  options: Partial<WoodOptions> = {},
  factory: CanvasFactory = domCanvasFactory,
): CanvasLike {
  const resolved: WoodOptions = { ...DEFAULT_WOOD_OPTIONS, ...options };
  const canvas = factory(resolved.width, resolved.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not acquire a 2D context for the wood texture');
  }
  drawWood(ctx, resolved);
  return canvas;
}

/** Convert a drawn canvas into a texture ready for a material. */
export function toTexture(canvas: CanvasLike, repeat = 1): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas as unknown as HTMLCanvasElement);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.anisotropy = 4;
  return texture;
}

/** The globe skin: matte printed paper. Never glossy. */
export function createPaperMaterial(map: THREE.Texture): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map,
    roughness: 0.92,
    metalness: 0,
  });
}

/** The only metal in the scene. Reflections come from the scene environment. */
export function createBrassMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0xc9963f,
    roughness: 0.34,
    metalness: 1,
  });
}

export interface WoodMaterialOptions {
  /** Multiplied with the map. Used to darken the pedestal, which catches more
   *  light than the desk because it faces up. */
  tint?: number;
  roughness?: number;
}

export function createWoodMaterial(
  map: THREE.Texture,
  options: WoodMaterialOptions = {},
): THREE.MeshStandardMaterial {
  const { tint = 0xffffff, roughness = 0.74 } = options;
  return new THREE.MeshStandardMaterial({
    map,
    color: tint,
    roughness,
    metalness: 0.02,
  });
}

/**
 * The pedestal.
 *
 * Darker and rougher than the desk on purpose: its lathe surfaces face the key
 * light more directly, so at the desk's settings it rendered as pale frosted
 * glass rather than wood.
 */
export function createPedestalMaterial(map: THREE.Texture): THREE.MeshStandardMaterial {
  return createWoodMaterial(map, { tint: 0xa8815a, roughness: 0.88 });
}
