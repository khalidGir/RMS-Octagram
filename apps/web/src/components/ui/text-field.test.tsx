import { render, screen, fireEvent } from '@testing-library/react';
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

  it('renders a reveal toggle for password fields', () => {
    render(<TextField label="Password" type="password" />);
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: 'Show password' })).toBeInTheDocument();
  });

  it('toggles password visibility and the button label', () => {
    render(<TextField label="Password" type="password" />);
    const input = screen.getByLabelText('Password');
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(input).toHaveAttribute('type', 'text');
    fireEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(input).toHaveAttribute('type', 'password');
  });

  it('does not render a toggle for non-password fields', () => {
    render(<TextField label="Phone" type="tel" />);
    expect(screen.getByLabelText('Phone')).toHaveAttribute('type', 'tel');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('omits the toggle when the password field is disabled or read-only', () => {
    const { unmount } = render(<TextField label="Password" type="password" disabled />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    unmount();
    render(<TextField label="Password" type="password" readOnly />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
