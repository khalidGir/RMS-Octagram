import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { TextField } from './text-field';

describe('TextField', () => {
  it('renders with label', () => {
    render(<TextField label="Email" />);
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
  });

  it('associates label with input element', () => {
    render(<TextField label="Password" />);
    const input = screen.getByLabelText('Password');
    expect(input.tagName).toBe('INPUT');
  });

  it('shows error message', () => {
    render(<TextField label="Email" error="Required" />);
    expect(screen.getByText('Required')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
  });

  it('shows hint when no error', () => {
    render(<TextField label="Email" hint="We won't share this" />);
    expect(screen.getByText("We won't share this")).toBeInTheDocument();
  });

  it('hides hint when error is present', () => {
    render(<TextField label="Email" error="Invalid" hint="Help text" />);
    expect(screen.queryByText('Help text')).not.toBeInTheDocument();
  });
});
