import { PHASES, STATUS_MARK } from './phases';

export default function App() {
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

        <p style={{ margin: '28px 0 0', color: 'var(--wl-text-dim)', fontSize: 13 }}>
          P0 进行中 —— 工具链、类型、测试、CI。进度见 <code>PROGRESS.md</code>。
        </p>
      </section>
    </main>
  );
}
