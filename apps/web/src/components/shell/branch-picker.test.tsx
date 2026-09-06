import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BranchPicker } from './branch-picker';
import type { BranchOption } from './branch-provider';

const branches: BranchOption[] = [
  { id: 'b1', name: 'Main Branch', slug: 'main', isActive: true },
  { id: 'b2', name: 'Second Branch', slug: 'second', isActive: true },
];

describe('BranchPicker', () => {
  it('renders selected branch name', () => {
    render(<BranchPicker branches={branches} value="b1" onChange={vi.fn()} />);
    expect(screen.getByText('Main Branch')).toBeDefined();
  });

  it('opens dropdown on click', () => {
    render(<BranchPicker branches={branches} value="b1" onChange={vi.fn()} />);
    fireEvent.click(screen.getByText('Main Branch'));
    expect(screen.getByRole('listbox', { name: 'Active branch' })).toBeDefined();
  });

  it('calls onChange with branch id when option selected', () => {
    const onChange = vi.fn();
    render(<BranchPicker branches={branches} value="b1" onChange={onChange} />);
    fireEvent.click(screen.getByText('Main Branch'));
    fireEvent.click(screen.getByRole('option', { name: /Second Branch/ }));
    expect(onChange).toHaveBeenCalledWith('b2');
  });

  it('shows search input when > 7 branches', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      id: `b${i}`,
      name: `Branch ${i}`,
      slug: `branch-${i}`,
      isActive: true,
    }));
    render(<BranchPicker branches={many} value="b0" onChange={vi.fn()} />);
    fireEvent.click(screen.getByText('Branch 0'));
    expect(screen.getByLabelText('Search branches')).toBeDefined();
  });

  it('filters branches by search', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      id: `b${i}`,
      name: `Branch ${i}`,
      slug: `branch-${i}`,
      isActive: true,
    }));
    render(<BranchPicker branches={many} value="b0" onChange={vi.fn()} />);
    fireEvent.click(screen.getByText('Branch 0'));
    fireEvent.change(screen.getByLabelText('Search branches'), {
      target: { value: 'Branch 3' },
    });
    expect(screen.getByRole('option', { name: /Branch 3/ })).toBeDefined();
    expect(screen.queryByRole('option', { name: /Branch 1/ })).toBeNull();
  });

  it('closes on outside click', () => {
    render(
      <div>
        <span data-testid="outside">outside</span>
        <BranchPicker branches={branches} value="b1" onChange={vi.fn()} />
      </div>,
    );
    fireEvent.click(screen.getByText('Main Branch'));
    expect(screen.getByRole('listbox')).toBeDefined();
    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
