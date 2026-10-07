import { useEffect, useState } from 'react';

/** Minimal hash router. No dependency, no history API — just `#/path`. */
export function useHashRoute(): string {
  const [route, setRoute] = useState(() => readHash());

  useEffect(() => {
    const onChange = () => {
      setRoute(readHash());
    };
    window.addEventListener('hashchange', onChange);
    return () => {
      window.removeEventListener('hashchange', onChange);
    };
  }, []);

  return route;
}

function readHash(): string {
  const raw = window.location.hash.replace(/^#/, '');
  return raw === '' ? '/' : raw;
}

export function navigate(route: string): void {
  window.location.hash = route;
}
