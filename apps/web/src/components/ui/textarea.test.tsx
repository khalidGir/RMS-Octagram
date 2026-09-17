import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Textarea } from './textarea';

describe('Textarea', () => {
  it('renders with label', () => {
    render(<Textarea label="Notes" />);
    expect(screen.getByLabelText('Notes')).toBeDefined();
  });

  it('shows error message', () => {
    render(<Textarea label="Notes" error="Required" />);
    expect(screen.getByText('Required')).toBeDefined();
    expect(screen.getByLabelText('Notes')).toHaveAttribute('aria-invalid', 'true');
  });

  it('shows hint when no error', () => {
    render(<Textarea label="Notes" hint="Optional" />);
    expect(screen.getByText('Optional')).toBeDefined();
  });

  it('hides hint when error is present', () => {
    render(<Textarea label="Notes" error="Required" hint="Optional" />);
    expect(screen.queryByText('Optional')).toBeNull();
  });
});
