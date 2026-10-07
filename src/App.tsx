import { Suspense, lazy } from 'react';
import PhaseBoard from './dev/PhaseBoard';
import { useHashRoute } from './dev/router';

/**
 * Every layer gets a page it can be exercised on in isolation
 * (see `docs/ARCHITECTURE.md`).
 *
 * The dev pages are lazy-loaded, which is not a micro-optimisation: `three.js`
 * is ~600 KB and only the scene page needs it. Loading it eagerly would put the
 * whole 3D engine in front of a user who just wants to see the phase board.
 * Routing stays hash-based and dependency-free — there is one real screen and a
 * handful of dev pages, which does not justify a router library.
 */
const DataPage = lazy(() => import('./dev/DataPage'));
const GlobePage = lazy(() => import('./dev/GlobePage'));
const PinsPage = lazy(() => import('./dev/PinsPage'));

function RouteFallback() {
  return (
    <p
      style={{
        position: 'fixed',
        inset: 0,
        display: 'grid',
        placeItems: 'center',
        margin: 0,
        color: 'var(--wl-text-dim)',
        fontSize: 13,
        letterSpacing: '0.06em',
      }}
    >
      加载中…
    </p>
  );
}

export default function App() {
  const route = useHashRoute();

  if (route === '/dev/data') {
    return (
      <Suspense fallback={<RouteFallback />}>
        <DataPage />
      </Suspense>
    );
  }

  if (route === '/dev/globe') {
    return (
      <Suspense fallback={<RouteFallback />}>
        <GlobePage />
      </Suspense>
    );
  }

  if (route === '/dev/pins') {
    return (
      <Suspense fallback={<RouteFallback />}>
        <PinsPage />
      </Suspense>
    );
  }

  return <PhaseBoard />;
}
