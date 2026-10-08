/**
 * three.js stage setup, kept out of React on purpose.
 *
 * Everything here is plain imperative three.js: build it, hand back a `dispose`,
 * a promise for when the printed skin lands, and a setter for the station pins.
 * React's only job is to mount it and react to coarse status changes, which
 * keeps re-renders away from the frame loop.
 *
 * Throws synchronously when WebGL is unavailable — the caller turns that into
 * user-visible state.
 */

import * as THREE from 'three';
import { loadLandRings } from './geo/land';
import { createPaperTexture } from './paperTexture';
import { createWoodTexture, toTexture } from './materials';
import { createGlobe, GLOBE_RADIUS } from './globeMesh';
import { createDesk, createEnvironment, createLighting } from './desk';
import { createPinField, type PinField } from './pins';
import type { Station } from '../types/domain';

export interface SceneStats {
  fps: number;
  triangles: number;
  drawCalls: number;
  /** Frames rendered since the stage was created. */
  frames: number;
  /** Pins currently on the globe. */
  pinCount: number;
}

export interface HoverInfo {
  station: Station;
  /** Pointer-relative screen position of the pin, in CSS pixels. */
  x: number;
  y: number;
}

export interface GlobeStageOptions {
  /** Idle spin, radians per second. Zero freezes the globe. */
  idleSpin: number;
  /** Vertical camera angle limits, in degrees. */
  elevationRange: readonly [number, number];
  onStats?: (stats: SceneStats) => void;
  onHover?: (info: HoverInfo | null) => void;
  onPick?: (station: Station) => void;
}

export interface GlobeStage {
  dispose(): void;
  /** Resolves once the land geometry has been drawn onto the globe. */
  skinReady: Promise<void>;
  /**
   * Replace the station pins.
   *
   * A setter rather than a constructor argument because the directory takes ~90s
   * to arrive on a cold cache. Rebuilding the whole stage when it lands would
   * flash the scene; swapping one `InstancedMesh` does not.
   */
  setStations(stations: readonly Station[]): void;
}

const INITIAL_ELEVATION_DEGREES = 21;
const INITIAL_DISTANCE = 5.3;
const CAMERA_FOV = 35;
const MIN_DISTANCE = 2.4;
const MAX_DISTANCE = 9;
/** Seconds of no input before the idle spin resumes. */
const IDLE_RESUME_DELAY = 2.5;
/** Radians of spin per pixel dragged. */
const DRAG_SPIN_PER_PIXEL = 0.006;
/** Fraction of spin velocity retained per second — the "flick" decay. */
const SPIN_DAMPING_PER_SECOND = 0.08;
const STATS_INTERVAL_MS = 500;
/** Pointer travel below this counts as a click rather than a drag. */
const CLICK_SLOP_PX = 5;

export function createGlobeStage(container: HTMLElement, options: GlobeStageOptions): GlobeStage {
  const { idleSpin, elevationRange, onStats, onHover, onPick } = options;

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth || 1, container.clientHeight || 1, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.98;

  const canvas = renderer.domElement;
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.touchAction = 'none';
  canvas.style.cursor = 'grab';
  container.appendChild(canvas);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x14110e);

  const camera = new THREE.PerspectiveCamera(
    CAMERA_FOV,
    (container.clientWidth || 1) / (container.clientHeight || 1),
    0.1,
    100,
  );

  // --- Environment, desk, lights ----------------------------------------
  // Brass at metalness 1 is almost entirely reflective; without an environment
  // it renders near-black no matter how many lights are added.
  const environment = createEnvironment(renderer);
  scene.environment = environment;
  scene.environmentIntensity = 0.55;

  const woodTexture = toTexture(createWoodTexture({ seed: 0x3d2c }));
  const lighting = createLighting(GLOBE_RADIUS);
  scene.add(lighting.key, lighting.fill);

  // --- Globe -------------------------------------------------------------
  // Start with a paper-only skin so the page shows something immediately.
  //
  // Deliberately tiny: this texture is on screen for well under a second, and a
  // full 4096x2048 draw here would block the main thread long enough to delay
  // the station pins — which is the thing the user is actually waiting for.
  const placeholderSkin = toTexture(
    createPaperTexture([], { width: 512, height: 256, noise: { dots: 400 } }),
  );
  const globe = createGlobe({ skin: placeholderSkin, wood: woodTexture });
  scene.add(globe.root);

  const desk = createDesk({
    y: globe.layout.deskY,
    size: GLOBE_RADIUS * 40,
    texture: woodTexture,
    repeat: 8,
  });
  scene.add(desk);

  // --- Pins --------------------------------------------------------------
  let pinField: PinField | null = null;

  const clearPins = (): void => {
    if (!pinField) return;
    globe.spinner.remove(pinField.object);
    pinField.dispose();
    pinField = null;
  };

  const setStations = (stations: readonly Station[]): void => {
    clearPins();
    if (stations.length === 0) return;
    pinField = createPinField(stations, { radius: GLOBE_RADIUS });
    globe.spinner.add(pinField.object);
  };

  // --- Camera rig --------------------------------------------------------
  let elevation = THREE.MathUtils.degToRad(INITIAL_ELEVATION_DEGREES);
  let distance = INITIAL_DISTANCE;

  const placeCamera = (): void => {
    const horizontal = Math.cos(elevation) * distance;
    camera.position.set(0, Math.sin(elevation) * distance, horizontal);
    // Aim slightly to the right of the globe so it sits a little left of centre
    // (`docs/VISUAL.md` asks for a rule-of-thirds-ish composition), and slightly
    // below its equator so the pedestal stays fully in frame. Aiming *above*
    // centre pushes the globe down and crops the base.
    camera.lookAt(GLOBE_RADIUS * 0.22, -GLOBE_RADIUS * 0.12, 0);
  };
  placeCamera();

  // --- Interaction -------------------------------------------------------
  let spinVelocity = 0;
  let dragging = false;
  let pointerId: number | null = null;
  let lastX = 0;
  let lastY = 0;
  let dragTravel = 0;
  let lastInteraction = 0;
  let pointerInside = false;
  let hoveredIndex: number | null = null;
  /** Latest pointer position, resolved once per frame rather than per event. */
  let pendingHover: { x: number; y: number } | null = null;

  const viewport = (): { width: number; height: number; rect: DOMRect } => {
    const rect = canvas.getBoundingClientRect();
    return { width: rect.width, height: rect.height, rect };
  };

  const onPointerDown = (event: PointerEvent): void => {
    dragging = true;
    pointerId = event.pointerId;
    lastX = event.clientX;
    lastY = event.clientY;
    dragTravel = 0;
    lastInteraction = performance.now();
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor = 'grabbing';
  };

  const onPointerMove = (event: PointerEvent): void => {
    pointerInside = true;

    if (!dragging || event.pointerId !== pointerId) {
      const { rect } = viewport();
      pendingHover = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      return;
    }

    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    dragTravel += Math.abs(dx) + Math.abs(dy);
    lastInteraction = performance.now();

    // Horizontal drag spins the globe about its own tilted axis — the one
    // motion a real desk globe actually has.
    globe.spinner.rotation.y += dx * DRAG_SPIN_PER_PIXEL;
    spinVelocity = dx * DRAG_SPIN_PER_PIXEL;

    // Vertical drag moves the camera instead of tilting the globe, so the
    // pedestal never leans.
    const [minElevation, maxElevation] = elevationRange;
    elevation = THREE.MathUtils.clamp(
      elevation + THREE.MathUtils.degToRad(dy * 0.25),
      THREE.MathUtils.degToRad(minElevation),
      THREE.MathUtils.degToRad(maxElevation),
    );
    placeCamera();
  };

  const endDrag = (event: PointerEvent): void => {
    if (event.pointerId !== pointerId) return;

    const wasClick = dragTravel <= CLICK_SLOP_PX;
    dragging = false;
    pointerId = null;
    lastInteraction = performance.now();
    canvas.style.cursor = 'grab';
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }

    if (wasClick && pinField && onPick) {
      const { width, height, rect } = viewport();
      const index = pinField.nearestToScreen(
        event.clientX - rect.left,
        event.clientY - rect.top,
        camera,
        { width, height },
      );
      const station = index === null ? null : pinField.stations[index];
      if (station) onPick(station);
    }
  };

  const onPointerLeave = (): void => {
    pointerInside = false;
    pendingHover = null;
  };

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    lastInteraction = performance.now();
    distance = THREE.MathUtils.clamp(
      distance * (1 + event.deltaY * 0.001),
      MIN_DISTANCE,
      MAX_DISTANCE,
    );
    placeCamera();
  };

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerleave', onPointerLeave);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  /**
   * Resolve hover at most once per frame.
   *
   * `pointermove` fires far more often than the display refreshes, and each
   * resolve projects every pin — doing that per event would burn real time for
   * no visible benefit.
   */
  const resolveHover = (): void => {
    if (!pinField) {
      if (hoveredIndex !== null) {
        hoveredIndex = null;
        onHover?.(null);
      }
      return;
    }

    if (!pendingHover || dragging || !pointerInside) return;

    const { width, height } = viewport();
    const index = pinField.nearestToScreen(pendingHover.x, pendingHover.y, camera, {
      width,
      height,
    });

    if (index === hoveredIndex) {
      // Same pin: refresh the tooltip position so it tracks the pointer.
      if (index !== null) {
        const station = pinField.stations[index];
        if (station) onHover?.({ station, x: pendingHover.x, y: pendingHover.y });
      }
      return;
    }

    hoveredIndex = index;
    pinField.setHighlight(index);
    canvas.style.cursor = index === null ? 'grab' : 'pointer';

    const station = index === null ? null : pinField.stations[index];
    onHover?.(station ? { station, x: pendingHover.x, y: pendingHover.y } : null);
  };

  // --- Resize ------------------------------------------------------------
  const resize = (): void => {
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width === 0 || height === 0) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };

  const observer = new ResizeObserver(resize);
  observer.observe(container);

  // --- Land, arriving late ------------------------------------------------
  const skinReady = loadLandRings().then(
    (polygons) =>
      new Promise<void>((resolve) => {
        /**
         * Yield one macrotask before drawing the real skin.
         *
         * Drawing a 4096x2048 canvas with ~1400 polygons, twice (rim + ink), is
         * the single most expensive thing at startup — measured at several
         * seconds of main-thread block. Doing it here rather than in the same
         * microtask as the fetch lets the first frame render, the station pins
         * appear, and the scene settle before the CPU is taken away.
         */
        setTimeout(() => {
          const skin = toTexture(createPaperTexture(polygons));
          skin.wrapS = THREE.ClampToEdgeWrapping;
          skin.wrapT = THREE.ClampToEdgeWrapping;
          skin.anisotropy = renderer.capabilities.getMaxAnisotropy();

          const material = globe.sphere.material as THREE.MeshStandardMaterial;
          const previous = material.map;
          material.map = skin;
          material.needsUpdate = true;
          previous?.dispose();
          resolve();
        }, 0);
      }),
  );

  // --- Frame loop ---------------------------------------------------------
  const clock = new THREE.Clock();
  let frameHandle = 0;
  let frames = 0;
  let framesSinceReport = 0;
  let reportStart = performance.now();

  const tick = (): void => {
    frameHandle = requestAnimationFrame(tick);
    const delta = Math.min(clock.getDelta(), 0.1);
    frames += 1;

    if (!dragging) {
      const idle = (performance.now() - lastInteraction) / 1000 > IDLE_RESUME_DELAY;
      spinVelocity *= Math.pow(SPIN_DAMPING_PER_SECOND, delta);
      if (Math.abs(spinVelocity) < 0.001) spinVelocity = 0;
      globe.spinner.rotation.y += spinVelocity * delta;
      if (idle) globe.spinner.rotation.y += idleSpin * delta;
    }

    renderer.render(scene, camera);

    // After the render, so the matrices the pick uses match what was drawn.
    resolveHover();

    framesSinceReport += 1;
    const now = performance.now();
    const elapsed = now - reportStart;
    if (elapsed >= STATS_INTERVAL_MS) {
      onStats?.({
        fps: Math.round((framesSinceReport * 1000) / elapsed),
        triangles: renderer.info.render.triangles,
        drawCalls: renderer.info.render.calls,
        frames,
        pinCount: pinField?.count ?? 0,
      });
      framesSinceReport = 0;
      reportStart = now;
    }
  };
  tick();

  let disposed = false;

  return {
    skinReady,
    setStations,
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frameHandle);
      observer.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', endDrag);
      canvas.removeEventListener('pointercancel', endDrag);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('wheel', onWheel);

      clearPins();
      globe.dispose();
      desk.geometry.dispose();
      (desk.material as THREE.MeshStandardMaterial).dispose();
      lighting.dispose();
      environment.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}
