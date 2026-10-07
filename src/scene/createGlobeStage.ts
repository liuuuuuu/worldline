/**
 * three.js stage setup, kept out of React on purpose.
 *
 * Everything here is plain imperative three.js: build it, hand back a `dispose`
 * and a promise for when the printed skin lands. React's only job is to mount
 * it and react to coarse status changes, which keeps re-renders away from the
 * frame loop.
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

export interface SceneStats {
  fps: number;
  triangles: number;
  drawCalls: number;
  /** Frames rendered since the stage was created. */
  frames: number;
}

export interface GlobeStageOptions {
  /** Idle spin, radians per second. Zero freezes the globe. */
  idleSpin: number;
  /** Vertical camera angle limits, in degrees. */
  elevationRange: readonly [number, number];
  onStats?: (stats: SceneStats) => void;
}

export interface GlobeStage {
  dispose(): void;
  /** Resolves once the land geometry has been drawn onto the globe. */
  skinReady: Promise<void>;
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

export function createGlobeStage(container: HTMLElement, options: GlobeStageOptions): GlobeStage {
  const { idleSpin, elevationRange, onStats } = options;

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
  // Start with a paper-only skin so the page shows something immediately;
  // waiting on 545 KB of coastline data would make it feel broken.
  const placeholderSkin = toTexture(createPaperTexture([]));
  const globe = createGlobe({ skin: placeholderSkin, wood: woodTexture });
  scene.add(globe.root);

  const desk = createDesk({
    y: globe.layout.deskY,
    size: GLOBE_RADIUS * 40,
    texture: woodTexture,
    repeat: 8,
  });
  scene.add(desk);

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
  let lastInteraction = 0;

  const onPointerDown = (event: PointerEvent): void => {
    dragging = true;
    pointerId = event.pointerId;
    lastX = event.clientX;
    lastY = event.clientY;
    lastInteraction = performance.now();
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor = 'grabbing';
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (!dragging || event.pointerId !== pointerId) return;

    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
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
    dragging = false;
    pointerId = null;
    lastInteraction = performance.now();
    canvas.style.cursor = 'grab';
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
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
  canvas.addEventListener('wheel', onWheel, { passive: false });

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
  const skinReady = loadLandRings().then((polygons) => {
    const skin = toTexture(createPaperTexture(polygons));
    skin.wrapS = THREE.ClampToEdgeWrapping;
    skin.wrapT = THREE.ClampToEdgeWrapping;
    skin.anisotropy = renderer.capabilities.getMaxAnisotropy();

    const material = globe.sphere.material as THREE.MeshStandardMaterial;
    const previous = material.map;
    material.map = skin;
    material.needsUpdate = true;
    previous?.dispose();
  });

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

    framesSinceReport += 1;
    const now = performance.now();
    const elapsed = now - reportStart;
    if (elapsed >= STATS_INTERVAL_MS) {
      onStats?.({
        fps: Math.round((framesSinceReport * 1000) / elapsed),
        triangles: renderer.info.render.triangles,
        drawCalls: renderer.info.render.calls,
        frames,
      });
      framesSinceReport = 0;
      reportStart = now;
    }
  };
  tick();

  let disposed = false;

  return {
    skinReady,
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frameHandle);
      observer.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', endDrag);
      canvas.removeEventListener('pointercancel', endDrag);
      canvas.removeEventListener('wheel', onWheel);

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
