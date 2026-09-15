import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api-client';
import { FulfillmentTimeline } from './order-fulfillment-timeline';

vi.mock('@/lib/api-client', () => ({
  apiRequest: vi.fn(),
}));

vi.mock('@/components/auth-provider', () => ({
  useAuth: vi.fn(() => ({
    accessToken: 'test-token',
    csrfToken: 'csrf',
    profile: { memberships: [{ tenant: { id: 't1' } }] },
  })),
}));

const mockApiRequest = vi.mocked(apiRequest);

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('FulfillmentTimeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state', () => {
    mockApiRequest.mockReturnValue(new Promise(() => {}) as any);
    renderWithProviders(<FulfillmentTimeline orderId="o-1" />);
    expect(screen.getByText('Loading timeline...')).toBeDefined();
  });

  it('shows empty state when no tickets', async () => {
    mockApiRequest.mockResolvedValue({ data: [] } as any);
    renderWithProviders(<FulfillmentTimeline orderId="o-1" />);
    await waitFor(() => {
      expect(screen.getByText('No kitchen tickets for this order yet.')).toBeDefined();
    });
  });

  it('renders ticket with station name', async () => {
    mockApiRequest.mockResolvedValue({
      data: [{
        ticketId: 't-1',
        stationName: 'Grill',
        kitchenName: 'Main Kitchen',
        ticketNumber: '001',
        status: 'IN_PROGRESS',
        startedAt: '2024-01-01T10:00:00Z',
        readyAt: null,
        collectedAt: null,
        servedAt: null,
        completedAt: null,
        lines: [{ itemName: 'Special Tibs', quantity: 2, isRequired: true }],
      }],
    } as any);
    renderWithProviders(<FulfillmentTimeline orderId="o-1" />);
    await waitFor(() => {
      expect(screen.getByText('#001')).toBeDefined();
      expect(screen.getByText('Grill')).toBeDefined();
      expect(screen.getByText('Main Kitchen')).toBeDefined();
    });
  });

  it('renders ticket lines with optional badge', async () => {
    mockApiRequest.mockResolvedValue({
      data: [{
        ticketId: 't-1',
        stationName: 'Grill',
        kitchenName: 'Main Kitchen',
        ticketNumber: '001',
        status: 'READY',
        startedAt: '2024-01-01T10:00:00Z',
        readyAt: '2024-01-01T10:15:00Z',
        collectedAt: null,
        servedAt: null,
        completedAt: null,
        lines: [
          { itemName: 'Special Tibs', quantity: 2, isRequired: true },
          { itemName: 'Salad', quantity: 1, isRequired: false },
        ],
      }],
    } as any);
    renderWithProviders(<FulfillmentTimeline orderId="o-1" />);
    await waitFor(() => {
      expect(screen.getByText(/Special Tibs/)).toBeDefined();
      expect(screen.getByText(/Salad/)).toBeDefined();
      expect(screen.getByText('(opt)')).toBeDefined();
    });
  });
});
