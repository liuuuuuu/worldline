import { PHASES, STATUS_MARK } from '../phases';
import { navigate } from './router';

/** Landing page: where the project stands, and doors into the layer dev pages. */
export default function PhaseBoard() {
  return (
    <main
      style={{
        minHeight: '100%',
        display: 'grid',
        placeItems: 'center',
        padding: '48px 24px',
      }}
    >
      <section style={{ maxWidth: 560, width: '100%' }}>
        <h1 style={{ margin: 0, fontSize: 28, letterSpacing: '-0.02em' }}>Worldline</h1>
        <p style={{ margin: '8px 0 0', color: 'var(--wl-text-dim)', fontSize: 14 }}>
          别人做播放器，我们做「在场的幻觉」。
        </p>

        <ul
          style={{
            listStyle: 'none',
            margin: '32px 0 0',
            padding: 0,
            display: 'grid',
            gap: 8,
          }}
        >
          {PHASES.map((phase) => (
            <li
              key={phase.id}
              data-testid="phase-row"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 14px',
                borderRadius: 8,
                background: 'var(--wl-surface)',
                border: '1px solid var(--wl-border)',
                fontSize: 14,
                color: phase.status === 'todo' ? 'var(--wl-text-dim)' : 'var(--wl-text)',
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 18,
                  textAlign: 'center',
                  color: phase.status === 'todo' ? 'var(--wl-text-dim)' : 'var(--wl-brass)',
                }}
              >
                {STATUS_MARK[phase.status]}
              </span>
              <span style={{ fontWeight: 500, minWidth: 36 }}>{phase.id}</span>
              <span>{phase.name}</span>
            </li>
          ))}
        </ul>

        <nav style={{ marginTop: 32 }}>
          <p
            style={{
              margin: '0 0 8px',
              color: 'var(--wl-text-dim)',
              fontSize: 12,
              letterSpacing: '0.08em',
            }}
          >
            分层验证页
          </p>
          <button
            type="button"
            onClick={() => {
              navigate('/dev/data');
            }}
            style={{
              background: 'transparent',
              border: '1px solid var(--wl-brass)',
              color: 'var(--wl-brass)',
              borderRadius: 6,
              padding: '8px 14px',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            L1 数据层 → /dev/data
          </button>
        </nav>

        <p style={{ margin: '28px 0 0', color: 'var(--wl-text-dim)', fontSize: 13 }}>
          进度见 <code>PROGRESS.md</code>。
        </p>
      </section>
    </main>
  );
}
