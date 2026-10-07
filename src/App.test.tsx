import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from './App';
import { PHASES } from './phases';

describe('App', () => {
  it('renders the product name', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Worldline' })).toBeInTheDocument();
  });

  it('renders one row per phase', () => {
    render(<App />);
    expect(screen.getAllByTestId('phase-row')).toHaveLength(PHASES.length);
  });

  it('marks exactly one phase as active', () => {
    expect(PHASES.filter((phase) => phase.status === 'active')).toHaveLength(1);
  });
});
