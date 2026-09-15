import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/lib/use-expo', () => ({
  useReleaseOrder: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useRecallExpoOrder: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
}));

vi.mock('@/components/auth-provider', () => ({
  useAuth: vi.fn(() => ({ accessToken: 'test-token' })),
}));

import { ExpoOrderCard } from './expo-order-card';
import type { ExpoOrder } from '@/lib/fulfillment-types';
import { OrderType, FulfillmentStatus, TicketStatus } from '@rms/contracts';

const mockOrder: ExpoOrder = {
  orderId: 'o-1',
  orderNumber: '1048',
  orderType: OrderType.DINE_IN,
  tableId: 'tbl-8',
  tableLabel: 'Table 8',
  customerName: null,
  fulfillmentStatus: FulfillmentStatus.PARTIALLY_READY,
  stations: [
    { stationId: 's-1', stationName: 'Grill', kitchenName: 'Main Kitchen', collectionLabel: 'Main pass', ticketId: 't-1', status: TicketStatus.IN_PROGRESS, elapsed: 480, isRequired: true },
    { stationId: 's-3', stationName: 'Drinks', kitchenName: 'Bar', collectionLabel: 'Bar counter', ticketId: 't-2', status: TicketStatus.READY, elapsed: 120, isRequired: true },
  ],
  totalRequired: 2,
  readyCount: 1,
  collectedCount: 0,
  canRelease: false,
  canRecall: false,
  isReleased: false,
  releasedAt: null,
  releasedByUserId: null,
  createdAt: '',
  version: 3,
};

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('ExpoOrderCard', () => {
  it('renders order number', () => {
    renderWithProviders(<ExpoOrderCard order={mockOrder} />);
    expect(screen.getByText('#1048')).toBeDefined();
  });

  it('renders table label', () => {
    renderWithProviders(<ExpoOrderCard order={mockOrder} />);
    expect(screen.getByText('Table 8')).toBeDefined();
  });

  it('renders order type badge', () => {
    renderWithProviders(<ExpoOrderCard order={mockOrder} />);
    expect(screen.getByText('DINE_IN')).toBeDefined();
  });

  it('renders station list', () => {
    renderWithProviders(<ExpoOrderCard order={mockOrder} />);
    expect(screen.getByText('Grill')).toBeDefined();
    expect(screen.getByText('Drinks')).toBeDefined();
  });

  it('shows ready count', () => {
    renderWithProviders(<ExpoOrderCard order={mockOrder} />);
    expect(screen.getByText('1/2 ready')).toBeDefined();
  });

  it('shows release button when canRelease is true', () => {
    const releasableOrder = { ...mockOrder, canRelease: true };
    renderWithProviders(<ExpoOrderCard order={releasableOrder} />);
    expect(screen.getByText('Release for service')).toBeDefined();
  });

  it('shows not ready message when cannot release or recall', () => {
    renderWithProviders(<ExpoOrderCard order={mockOrder} />);
    expect(screen.getByText('Not ready for release')).toBeDefined();
  });
});
