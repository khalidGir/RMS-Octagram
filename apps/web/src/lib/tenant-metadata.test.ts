import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pickupBrandingMetadata, tableBrandingMetadata } from './tenant-metadata';
import { serverApi } from './server-api';
import type { PublicRestaurantContext, PublicTableContext, TenantLogoView } from './types';

vi.mock('./server-api', () => ({
  serverApi: { get: vi.fn(), post: vi.fn() },
  ServerApiError: class ServerApiError extends Error {},
}));

const logo: TenantLogoView = {
  icon192: 'https://cdn.example.com/logos/tok-abc/192x192.png',
  icon512: 'https://cdn.example.com/logos/tok-abc/512x512.png',
  maskable512: 'https://cdn.example.com/logos/tok-abc/512x512-maskable.png',
  apple180: 'https://cdn.example.com/logos/tok-abc/180x180.png',
  thumbnail: 'https://cdn.example.com/logos/tok-abc/320x320.webp',
};

const restaurantContext: PublicRestaurantContext = {
  tenant: { id: 'tenant-1', name: 'Habesha House' },
  branch: { id: 'branch-1', name: 'Main Branch', publicSlug: 'habesha-house' },
  logo,
  pickupEnabled: true,
  tableQrEnabled: true,
  availablePaymentMethods: ['CASH'],
};

const tableContext: PublicTableContext = {
  tenant: { id: 'tenant-1', name: 'Habesha House' },
  branch: { id: 'branch-1', name: 'Main Branch', publicSlug: 'habesha-house' },
  logo,
  table: { id: 'table-1', label: 'T1', capacity: 4 },
  diningArea: null,
  availableOrderTypes: ['DINE_IN'],
  availablePaymentMethods: ['CASH'],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('pickupBrandingMetadata', () => {
  it('points the manifest link at the slug-scoped route and titles from the restaurant name', async () => {
    vi.mocked(serverApi.get).mockResolvedValue(restaurantContext);
    const metadata = await pickupBrandingMetadata('habesha-house');
    expect(serverApi.get).toHaveBeenCalledWith('/public/restaurants/habesha-house');
    expect(metadata.manifest).toBe('/r/habesha-house/manifest.webmanifest');
    expect(metadata.title).toEqual({ absolute: 'Habesha House' });
    expect(metadata.applicationName).toBe('Habesha House');
    expect(metadata.appleWebApp).toEqual({
      capable: true,
      title: 'Habesha House',
      statusBarStyle: 'black-translucent',
    });
  });

  it('adds the apple touch icon only when a logo exists', async () => {
    vi.mocked(serverApi.get).mockResolvedValue({ ...restaurantContext, logo });
    const withLogo = await pickupBrandingMetadata('habesha-house');
    expect(withLogo.icons).toEqual({
      apple: [{ url: logo.apple180, sizes: '180x180', type: 'image/png' }],
    });

    vi.mocked(serverApi.get).mockResolvedValue({ ...restaurantContext, logo: null });
    const withoutLogo = await pickupBrandingMetadata('habesha-house');
    expect(withoutLogo.icons).toBeUndefined();
  });

  it('falls back to root defaults when the API is unavailable', async () => {
    vi.mocked(serverApi.get).mockRejectedValue(new Error('network down'));
    await expect(pickupBrandingMetadata('habesha-house')).resolves.toEqual({});
  });
});

describe('tableBrandingMetadata', () => {
  it('never embeds the session token when the branch has a public slug', async () => {
    vi.mocked(serverApi.post).mockResolvedValue(tableContext);
    const metadata = await tableBrandingMetadata('secret-table-token');
    expect(metadata.manifest).toBe('/r/habesha-house/manifest.webmanifest');
    expect(JSON.stringify(metadata)).not.toContain('secret-table-token');
  });

  it('falls back to the token-scoped manifest route without a slug', async () => {
    vi.mocked(serverApi.post).mockResolvedValue({
      ...tableContext,
      branch: { ...tableContext.branch, publicSlug: null },
    });
    const metadata = await tableBrandingMetadata('secret-table-token');
    // The route itself still serves token-free manifest content; only the href carries the token.
    expect(metadata.manifest).toBe('/o/secret-table-token/manifest.webmanifest');
  });

  it('falls back to root defaults when resolution fails', async () => {
    vi.mocked(serverApi.post).mockRejectedValue(new Error('expired token'));
    await expect(tableBrandingMetadata('secret-table-token')).resolves.toEqual({});
  });
});
