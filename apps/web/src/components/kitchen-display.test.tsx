import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '@/components/locale-provider';
import { useKdsTickets, type KdsTicket, type KdsStation } from '@/lib/use-kds-tickets';
import { useKitchens } from '@/lib/use-kitchen-config';
import { KitchenDisplay } from './kitchen-display';

vi.mock('@/lib/use-kds-tickets', () => ({ useKdsTickets: vi.fn() }));
vi.mock('@/lib/use-kitchen-config', () => ({ useKitchens: vi.fn() }));

const mockUseKdsTickets = vi.mocked(useKdsTickets);
const mockUseKitchens = vi.mocked(useKitchens);

const stations: KdsStation[] = [
  { id: 's-grill', name: 'Grill', kitchenId: 'k-main', displayOrder: 0, isActive: true, menuItemIds: [] },
  { id: 's-bar', name: 'Bar Station', kitchenId: 'k-bar', displayOrder: 1, isActive: true, menuItemIds: [] },
];

const tickets: KdsTicket[] = [
  {
    id: 't-bar', orderId: 'o-1', stationId: 's-bar', kitchenId: 'k-bar',
    ticketNumber: '1', status: 'QUEUED', priority: 0, estimatedReadyAt: null,
    startedAt: null, readyAt: null, completedAt: null, version: 1,
    createdAt: new Date().toISOString(),
  },
];

function renderWithProviders(ui: React.ReactElement) {
  return render(<LocaleProvider>{ui}</LocaleProvider>);
}

describe('KitchenDisplay kitchen switching', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseKitchens.mockReturnValue({
      data: [
        { id: 'k-main', name: 'Main Kitchen' },
        { id: 'k-bar', name: 'Bar' },
      ],
      isLoading: false,
    } as never);
    mockUseKdsTickets.mockReturnValue({
      tickets,
      stations,
      loading: false,
      error: null,
      socketStatus: 'connected',
      refetch: vi.fn(),
      reconnect: vi.fn(),
      bumpTicket: vi.fn(),
      recallTicket: vi.fn(),
      completeTicket: vi.fn(),
      cancelTicket: vi.fn(),
    } as never);
  });

  afterEach(() => {
    cleanup();
  });

  it('queries with no kitchen filter until a kitchen is selected', () => {
    renderWithProviders(<KitchenDisplay branchId="b-1" />);

    expect(mockUseKdsTickets).toHaveBeenCalledWith(
      expect.objectContaining({ branchId: 'b-1', kitchenId: null, stationId: null }),
    );
  });

  it('passes the selected kitchen to the ticket query and shows only its stations', () => {
    renderWithProviders(<KitchenDisplay branchId="b-1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Bar' }));

    expect(mockUseKdsTickets).toHaveBeenLastCalledWith(
      expect.objectContaining({ branchId: 'b-1', kitchenId: 'k-bar', stationId: null }),
    );

    expect(screen.getByRole('button', { name: 'Bar Station' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Grill' })).toBeNull();
  });

  it('switches station chips when another kitchen is selected', () => {
    renderWithProviders(<KitchenDisplay branchId="b-1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Main Kitchen' }));

    expect(mockUseKdsTickets).toHaveBeenLastCalledWith(
      expect.objectContaining({ kitchenId: 'k-main' }),
    );
    expect(screen.getByRole('button', { name: 'Grill' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Bar Station' })).toBeNull();
  });

  it('clears the kitchen filter when All kitchens is selected', () => {
    renderWithProviders(<KitchenDisplay branchId="b-1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Bar' }));
    fireEvent.click(screen.getByRole('button', { name: 'All kitchens' }));

    expect(mockUseKdsTickets).toHaveBeenLastCalledWith(
      expect.objectContaining({ kitchenId: null, stationId: null }),
    );
    expect(screen.queryByRole('button', { name: 'Bar Station' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Grill' })).toBeNull();
  });
});
