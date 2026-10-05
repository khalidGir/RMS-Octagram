import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useKitchens } from '@/lib/use-kitchen-config';
import { LocaleProvider } from '@/components/locale-provider';
import { KitchenList } from './kitchen-list';

vi.mock('@/lib/use-kitchen-config', () => ({
  useKitchens: vi.fn(() => ({ data: [], isLoading: false })),
  useCreateKitchen: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useUpdateKitchen: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useDeleteKitchen: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useStations: vi.fn(() => ({ data: [] })),
}));

vi.mock('@/components/auth-provider', () => ({
  useAuth: vi.fn(() => ({ accessToken: 'test-token' })),
}));

const mockUseKitchens = vi.mocked(useKitchens);

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <LocaleProvider>
      <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
    </LocaleProvider>
  );
}

describe('KitchenList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseKitchens.mockReturnValue({ data: [], isLoading: false } as any);
  });

  it('shows loading state', () => {
    mockUseKitchens.mockReturnValue({ data: undefined, isLoading: true } as any);
    renderWithProviders(<KitchenList />);
    expect(screen.getByText('Loading kitchens...')).toBeDefined();
  });

  it('shows empty state when no kitchens', () => {
    renderWithProviders(<KitchenList />);
    expect(screen.getByText('No kitchens yet')).toBeDefined();
    expect(screen.getByText('Create your first kitchen to configure stations and routing.')).toBeDefined();
  });

  it('renders kitchen count', () => {
    mockUseKitchens.mockReturnValue({
      data: [
        { id: 'k-1', name: 'Main Kitchen', description: 'Primary', collectionLabel: 'Main pass', displayOrder: 0, isActive: true, tenantId: 't1', branchId: 'b1', createdAt: '', updatedAt: '' },
        { id: 'k-2', name: 'Bar', description: null, collectionLabel: null, displayOrder: 1, isActive: true, tenantId: 't1', branchId: 'b1', createdAt: '', updatedAt: '' },
      ],
      isLoading: false,
    } as any);
    renderWithProviders(<KitchenList />);
    expect(screen.getByText('2 kitchens')).toBeDefined();
  });

  it('shows add kitchen button', () => {
    renderWithProviders(<KitchenList />);
    expect(screen.getByText('Add kitchen')).toBeDefined();
  });
});
