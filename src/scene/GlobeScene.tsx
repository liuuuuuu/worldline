/**
 * The 3D stage as a React component.
 *
 * Thin on purpose: all three.js work lives in `createGlobeStage`. This component
 * mounts it, tracks coarse status (loading / ready / error) and overlays the
 * vignette and grain.
 *
 * Every state write happens inside a promise callback. Setting state
 * synchronously in an effect body triggers a cascading render, and the scene
 * setup genuinely is asynchronous anyway — the land geometry arrives after the
 * first frame.
 */

import { useEffect, useRef, useState } from 'react';
import { createGlobeStage, type SceneStats } from './createGlobeStage';

export type { SceneStats };

export interface GlobeSceneProps {
  /** Reported roughly twice a second. */
  onStats?: (stats: SceneStats) => void;
  /** Idle spin, radians per second. Zero freezes the globe. */
  idleSpin?: number;
  /** Vertical camera angle limits, in degrees. */
  elevationRange?: readonly [number, number];
}

const DEFAULT_ELEVATION: readonly [number, number] = [6, 58];

export default function GlobeScene({
  onStats,
  idleSpin = 0.03,
  elevationRange = DEFAULT_ELEVATION,
}: GlobeSceneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    let teardown: (() => void) | null = null;

    Promise.resolve()
      .then(() =>
        createGlobeStage(container, {
          idleSpin,
          elevationRange,
          ...(onStats ? { onStats } : {}),
        }),
      )
      .then((stage) => {
        if (disposed) {
          stage.dispose();
          return null;
        }
        // Wrap rather than assign the method: an unbound `dispose` would be
        // called with the wrong `this`.
        teardown = () => {
          stage.dispose();
        };
        // `skinReady` resolves to void, so wrap it — otherwise the next link
        // cannot tell "loaded" from "we bailed out".
        return stage.skinReady.then(() => true);
      })
      .then((ready) => {
        if (disposed || ready !== true) return;
        setStatus('ready');
      })
      .catch((error: unknown) => {
        if (disposed) return;
        setErrorMessage(error instanceof Error ? error.message : 'Failed to start the 3D scene');
        setStatus('error');
      });

    return () => {
      disposed = true;
      teardown?.();
    };
  }, [idleSpin, elevationRange, onStats]);

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />

      {/* Vignette and film grain live in the DOM rather than in a
          post-processing pass: it costs nothing and, crucially, it is part of
          the frame we screenshot. */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background:
            'radial-gradient(ellipse at 50% 46%, rgba(0,0,0,0) 42%, rgba(0,0,0,0.42) 100%)',
        }}
      />
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          opacity: 0.05,
          mixBlendMode: 'overlay',
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />

      {status === 'loading' && (
        <p
          data-testid="globe-status"
          style={{
            position: 'absolute',
            left: 24,
            bottom: 20,
            margin: 0,
            fontSize: 12,
            color: 'var(--wl-text-dim)',
            letterSpacing: '0.06em',
          }}
        >
          正在绘制地图…
        </p>
      )}

      {status === 'error' && (
        <p
          data-testid="globe-status"
          style={{
            position: 'absolute',
            left: 24,
            bottom: 20,
            margin: 0,
            fontSize: 12,
            color: '#e2726e',
          }}
        >
          {errorMessage}
        </p>
      )}
    </div>
  );
}
