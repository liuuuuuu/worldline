import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { PHASES } from './phases';

/**
 * `DataPage` fetches on mount. Stub `fetch` so the router tests stay offline and
 * deterministic — the page's own behaviour is covered by the source tests.
 */
function stubOfflineFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new Error('offline in tests'))),
  );
}

describe('App routing', () => {
  beforeEach(() => {
    stubOfflineFetch();
    window.location.hash = '';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.location.hash = '';
  });

  it('renders the phase board on the default route', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Worldline' })).toBeInTheDocument();
    expect(screen.getAllByTestId('phase-row')).toHaveLength(PHASES.length);
  });

  it('marks exactly one phase as active', () => {
    expect(PHASES.filter((phase) => phase.status === 'active')).toHaveLength(1);
  });

  it('renders the L1 data page on #/dev/data', async () => {
    window.location.hash = '#/dev/data';
    render(<App />);

    expect(await screen.findByRole('heading', { name: '/dev/data' })).toBeInTheDocument();
  });

  it('falls back to the phase board for an unknown route', () => {
    window.location.hash = '#/dev/nope';
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Worldline' })).toBeInTheDocument();
  });
});
