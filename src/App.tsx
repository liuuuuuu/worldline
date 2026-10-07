import DataPage from './dev/DataPage';
import PhaseBoard from './dev/PhaseBoard';
import { useHashRoute } from './dev/router';

/**
 * Every layer gets a page it can be exercised on in isolation
 * (see `docs/ARCHITECTURE.md`). Routing is hash-based and dependency-free
 * because the app has exactly one real screen plus a handful of dev pages.
 */
export default function App() {
  const route = useHashRoute();

  if (route === '/dev/data') {
    return <DataPage />;
  }

  return <PhaseBoard />;
}
