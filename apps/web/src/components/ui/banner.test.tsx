import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Banner } from './banner';

describe('Banner', () => {
  it('renders info variant', () => {
    render(<Banner variant="info">Heads up</Banner>);
    expect(screen.getByRole('status')).toBeDefined();
    expect(screen.getByText('Heads up')).toBeDefined();
  });

  it('renders with title', () => {
    render(<Banner variant="success" title="Saved">Done.</Banner>);
    expect(screen.getByText('Saved')).toBeDefined();
    expect(screen.getByText('Done.')).toBeDefined();
  });

  it('calls onDismiss when dismiss clicked', () => {
    const onDismiss = vi.fn();
    render(<Banner variant="danger" onDismiss={onDismiss}>Error</Banner>);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('renders warning variant', () => {
    render(<Banner variant="warning">Careful</Banner>);
    expect(screen.getByText('Careful')).toBeDefined();
  });
});
