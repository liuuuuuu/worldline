import { describe, expect, it } from 'vitest';
import {
  createPaperTexture,
  drawPaperMap,
  traceRing,
  DEFAULT_PAPER_OPTIONS,
  type PaperTextureOptions,
} from './paperTexture';
import type { Canvas2D, CanvasFactory, CanvasLike, FillStyle } from './canvas';
import type { PolygonRings } from './geo/land';

interface RecordedOp {
  op: string;
  args: readonly unknown[];
  fillStyle?: FillStyle;
  strokeStyle?: FillStyle;
  lineWidth?: number;
  globalAlpha?: number;
}

interface Recording {
  ctx: Canvas2D;
  ops: RecordedOp[];
  reset(): void;
}

/** A 2D context that records what was drawn, since jsdom has none. */
function createRecordingContext(patternAvailable = false): Recording {
  const ops: RecordedOp[] = [];
  const pattern = 'pattern' as unknown as CanvasPattern;

  const ctx: Canvas2D = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineJoin: 'round',
    globalAlpha: 1,
    save: () => ops.push({ op: 'save', args: [] }),
    restore: () => ops.push({ op: 'restore', args: [] }),
    beginPath: () => ops.push({ op: 'beginPath', args: [] }),
    moveTo: (x, y) => ops.push({ op: 'moveTo', args: [x, y] }),
    lineTo: (x, y) => ops.push({ op: 'lineTo', args: [x, y] }),
    closePath: () => ops.push({ op: 'closePath', args: [] }),
    fill: () => ops.push({ op: 'fill', args: [], fillStyle: ctx.fillStyle }),
    stroke: () =>
      ops.push({
        op: 'stroke',
        args: [],
        strokeStyle: ctx.strokeStyle,
        lineWidth: ctx.lineWidth,
      }),
    fillRect: (x, y, width, height) =>
      ops.push({
        op: 'fillRect',
        args: [x, y, width, height],
        fillStyle: ctx.fillStyle,
        globalAlpha: ctx.globalAlpha,
      }),
    createPattern: () => (patternAvailable ? pattern : null),
  };

  return {
    ctx,
    ops,
    reset: () => {
      ops.length = 0;
    },
  };
}

interface FakeFactory {
  factory: CanvasFactory;
  canvases: CanvasLike[];
  recorders: Recording[];
}

function createFakeFactory(contextsAvailable = true, patternAvailable = false): FakeFactory {
  const canvases: CanvasLike[] = [];
  const recorders: Recording[] = [];

  const factory: CanvasFactory = (width, height) => {
    const recording = createRecordingContext(patternAvailable);
    const canvas: CanvasLike = {
      width,
      height,
      getContext: () => (contextsAvailable ? recording.ctx : null),
    };
    canvases.push(canvas);
    recorders.push(recording);
    return canvas;
  };

  return { factory, canvases, recorders };
}

const SQUARE: PolygonRings[] = [
  [
    [
      [-10, 10],
      [10, 10],
      [10, -10],
      [-10, -10],
      [-10, 10],
    ],
  ],
];

describe('traceRing', () => {
  it('projects every vertex and closes the ring', () => {
    const { ctx, ops } = createRecordingContext();

    traceRing(
      ctx,
      [
        [0, 0],
        [90, 0],
        [90, 45],
      ],
      360,
      180,
    );

    expect(ops.map((entry) => entry.op)).toEqual(['moveTo', 'lineTo', 'lineTo', 'closePath']);
    expect(ops[0]?.args).toEqual([180, 90]);
    expect(ops[1]?.args).toEqual([270, 90]);
    expect(ops[2]?.args).toEqual([270, 45]);
  });

  it('breaks the path at the antimeridian instead of streaking across the map', () => {
    const { ctx, ops } = createRecordingContext();

    traceRing(
      ctx,
      [
        [179, 10],
        [-179, 10],
      ],
      360,
      180,
    );

    // The jump from 179 to -179 is a wrap: restart the subpath, and do NOT
    // close it, because closing would draw the artefact we just avoided.
    expect(ops.map((entry) => entry.op)).toEqual(['moveTo', 'moveTo']);
    expect(ops.some((entry) => entry.op === 'closePath')).toBe(false);
  });

  it('ignores malformed positions rather than drawing to NaN', () => {
    const { ctx, ops } = createRecordingContext();

    traceRing(
      ctx,
      [
        [0, 0],
        [Number.NaN, 10],
        [20, Number.POSITIVE_INFINITY],
        [30, 30],
      ],
      360,
      180,
    );

    const coords = ops.filter((entry) => entry.op === 'moveTo' || entry.op === 'lineTo');
    expect(coords).toHaveLength(2);
    for (const entry of coords) {
      for (const value of entry.args) {
        expect(Number.isFinite(value as number)).toBe(true);
      }
    }
  });
});

describe('drawPaperMap', () => {
  const options: PaperTextureOptions = { ...DEFAULT_PAPER_OPTIONS, width: 360, height: 180 };

  it('paints the paper, then the graticule, then the land, then the coastline', () => {
    const { ctx, ops } = createRecordingContext();
    const { factory } = createFakeFactory();

    drawPaperMap(ctx, SQUARE, options, factory);

    // Paper base is a fillRect; land is a path fill.
    const rects = ops.filter((entry) => entry.op === 'fillRect');
    const fills = ops.filter((entry) => entry.op === 'fill');
    const strokes = ops.filter((entry) => entry.op === 'stroke');

    expect(rects[0]?.fillStyle).toBe(options.palette.paper);
    expect(fills.at(-1)?.fillStyle).toBe(options.palette.land);
    expect(strokes[0]?.strokeStyle).toBe(options.palette.graticule);
    expect(strokes.at(-1)?.strokeStyle).toBe(options.palette.coast);
    expect(strokes).toHaveLength(3);
  });

  it('lays paper grain over the base before anything is drawn on it', () => {
    const { ctx, ops } = createRecordingContext(true);
    const { factory } = createFakeFactory(true, true);

    drawPaperMap(ctx, SQUARE, options, factory);

    const rects = ops.filter((entry) => entry.op === 'fillRect');
    // Base, then grain, then nothing else rect-based.
    expect(rects).toHaveLength(2);
    expect(rects[1]?.globalAlpha).toBe(1);
    expect(rects[1]?.fillStyle).not.toBe(options.palette.paper);
  });

  it('draws the graticule under the land so it only shows over the ocean', () => {
    const { ctx, ops } = createRecordingContext();
    const { factory } = createFakeFactory();

    drawPaperMap(ctx, SQUARE, options, factory);

    const graticuleIndex = ops.findIndex(
      (entry) => entry.op === 'stroke' && entry.strokeStyle === options.palette.graticule,
    );
    const landIndex = ops.findIndex(
      (entry) => entry.op === 'fill' && entry.fillStyle === options.palette.land,
    );

    expect(graticuleIndex).toBeGreaterThan(-1);
    expect(landIndex).toBeGreaterThan(graticuleIndex);
  });

  it('draws the graticule thick enough to survive mipmapping', () => {
    const { ctx, ops } = createRecordingContext();
    const { factory } = createFakeFactory();

    drawPaperMap(ctx, SQUARE, options, factory);

    const graticule = ops.find(
      (entry) => entry.op === 'stroke' && entry.strokeStyle === options.palette.graticule,
    );
    // A 1px line on a 4096px texture vanishes once it is mapped onto a sphere.
    expect(graticule?.lineWidth).toBeGreaterThanOrEqual(2);
  });

  it('draws a rim stroke wider than the coastline ink', () => {
    const { ctx, ops } = createRecordingContext();
    const { factory } = createFakeFactory();

    drawPaperMap(ctx, SQUARE, options, factory);

    const strokes = ops.filter((entry) => entry.op === 'stroke');
    const rim = strokes.find((entry) => entry.strokeStyle === options.palette.landEdge);
    const coast = strokes.find((entry) => entry.strokeStyle === options.palette.coast);

    expect(rim?.lineWidth).toBeGreaterThan(coast?.lineWidth ?? 0);
  });

  it('balances save and restore', () => {
    const { ctx, ops } = createRecordingContext();
    const { factory } = createFakeFactory();

    drawPaperMap(ctx, SQUARE, options, factory);

    expect(ops.filter((entry) => entry.op === 'save')).toHaveLength(1);
    expect(ops.filter((entry) => entry.op === 'restore')).toHaveLength(1);
  });

  it('copes with an empty polygon list (the loading state)', () => {
    const { ctx } = createRecordingContext();
    const { factory } = createFakeFactory();

    expect(() => {
      drawPaperMap(ctx, [], options, factory);
    }).not.toThrow();
  });
});

describe('createPaperTexture', () => {
  it('creates a canvas at the requested size', () => {
    const { factory, canvases } = createFakeFactory();

    const canvas = createPaperTexture(SQUARE, { width: 512, height: 256 }, factory);

    expect(canvas.width).toBe(512);
    expect(canvas.height).toBe(256);
    expect(canvases[0]).toBe(canvas);
  });

  it('clamps degenerate sizes rather than producing an unusable texture', () => {
    const { factory } = createFakeFactory();

    expect(createPaperTexture(SQUARE, { width: 0, height: -5 }, factory).width).toBe(2);
    expect(createPaperTexture(SQUARE, { width: 0, height: -5 }, factory).height).toBe(2);
  });

  it('rounds fractional sizes', () => {
    const { factory } = createFakeFactory();
    expect(createPaperTexture(SQUARE, { width: 100.6, height: 50.2 }, factory).width).toBe(101);
  });

  it('throws a diagnosable error when no 2D context is available', () => {
    const { factory } = createFakeFactory(false);

    expect(() => createPaperTexture(SQUARE, {}, factory)).toThrow(/2D context/);
  });

  it('merges partial options over the defaults', () => {
    const { factory, recorders } = createFakeFactory();
    const custom = { palette: { ...DEFAULT_PAPER_OPTIONS.palette, paper: '#123456' } };

    createPaperTexture(SQUARE, custom, factory);

    const rects = recorders[0]?.ops.filter((entry) => entry.op === 'fillRect') ?? [];
    expect(rects[0]?.fillStyle).toBe('#123456');
  });
});
