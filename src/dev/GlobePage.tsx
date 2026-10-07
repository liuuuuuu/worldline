/**
 * L2 verification page — `/dev/globe`.
 *
 * Renders the globe at full viewport with nothing else competing for attention,
 * because the P2 exit criterion is subjective first: *could this screenshot pass
 * as a wallpaper?* The HUD stays small and out of the composition so the frame
 * can be captured as-is.
 */

import { useState } from 'react';
import GlobeScene, { type SceneStats } from '../scene/GlobeScene';
import { navigate } from './router';

export default function GlobePage() {
  const [stats, setStats] = useState<SceneStats | null>(null);

  return (
    <main style={{ position: 'fixed', inset: 0, background: '#14110e' }}>
      <GlobeScene onStats={setStats} />

      <div
        style={{
          position: 'absolute',
          top: 20,
          left: 24,
          pointerEvents: 'none',
          fontFamily: 'ui-monospace, monospace',
          fontSize: 12,
          lineHeight: 1.7,
          color: 'var(--wl-text-dim)',
          textShadow: '0 1px 6px rgba(0,0,0,0.8)',
        }}
      >
        <div style={{ color: 'var(--wl-brass)', letterSpacing: '0.08em' }}>
          L2 场景层 · /dev/globe
        </div>
        <div data-testid="globe-fps">fps {stats?.fps ?? '—'}</div>
        <div>triangles {(stats?.triangles ?? 0).toLocaleString('en-US')}</div>
        <div>draw calls {stats?.drawCalls ?? '—'}</div>
        <div>frames {(stats?.frames ?? 0).toLocaleString('en-US')}</div>
      </div>

      <button
        type="button"
        onClick={() => {
          navigate('/');
        }}
        style={{
          position: 'absolute',
          top: 20,
          right: 24,
          background: 'rgba(20,17,14,0.55)',
          border: '1px solid var(--wl-border)',
          color: 'var(--wl-text-dim)',
          borderRadius: 6,
          padding: '6px 12px',
          fontSize: 12,
          cursor: 'pointer',
        }}
      >
        返回
      </button>
    </main>
  );
}
