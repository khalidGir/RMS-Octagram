import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type * as ApiClient from '@/lib/api-client';
import { apiRequest } from '@/lib/api-client';
import { LocaleProvider } from '@/components/locale-provider';
import { TenantLogoCard } from './settings-management';

vi.mock('@/lib/api-client', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof ApiClient;
  return { ...actual, apiRequest: vi.fn() };
});

const mockApiRequest = vi.mocked(apiRequest);

const TENANT = 'tenant-1';
const STORAGE_KEY = `rms:logo-active-media:${TENANT}`;
const LEGACY_STORAGE_KEY = 'rms:logo-active-media';
const OLD_THUMB = 'https://cdn.example.test/old/320x320.webp';

type StatusBody = {
  mediaObjectId: string | null;
  processingStatus: string;
  rejectionReason: string | null;
  uploadExpiresAt: string | null;
  logo: { thumbnail: string; icon192: string } | null;
  tenantVersion: number;
};

const logoView = (thumbnail: string) => ({
  thumbnail,
  icon192: thumbnail,
  icon512: thumbnail,
  maskable512: thumbnail,
  apple180: thumbnail,
});

let attached: StatusBody;
let active: StatusBody[] = [];

function apiMock() {
  mockApiRequest.mockImplementation(async (url: string, options?: { method?: string }) => {
    if (url.includes('/logo/upload-intent')) {
      return {
        data: {
          mediaObjectId: 'm-new',
          uploadUrl: 'https://s3.example.test/upload',
          fields: { key: 'value' },
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
          tenantVersion: attached.tenantVersion,
        },
      };
    }
    if (url.includes('/logo/finalize')) {
      return { data: { mediaObjectId: 'm-new', processingStatus: 'PENDING_PROCESSING' } };
    }
    if (url.includes('/logo/status?mediaObjectId=')) {
      return { data: active.shift() ?? active[active.length - 1] ?? attached };
    }
    if (url.includes('/logo/status')) {
      return { data: attached };
    }
    if (options?.method === 'DELETE') {
      return { data: { success: true, tenantVersion: attached.tenantVersion + 1 } };
    }
    throw new Error(`Unexpected apiRequest: ${url}`);
  });
}

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <LocaleProvider>
      <QueryClientProvider client={client}>
        <TenantLogoCard isOwner accessToken="token" csrfToken="csrf" tenantId={TENANT} />
      </QueryClientProvider>
    </LocaleProvider>,
  );
}

function fileInput(container: HTMLElement) {
  const input = container.querySelector('input[type="file"]');
  if (!input) throw new Error('file input not found');
  return input as HTMLInputElement;
}

function pick(container: HTMLElement) {
  const input = fileInput(container);
  Object.defineProperty(input, 'files', {
    value: [new File(['x'], 'logo.png', { type: 'image/png' })],
    configurable: true,
  });
  fireEvent.change(input);
}

function statusCalls(fragment?: string) {
  return mockApiRequest.mock.calls.filter(
    ([url]) => url.includes('/logo/status') && (!fragment || url.includes(fragment)),
  ).length;
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  vi.stubGlobal('crypto', {
    subtle: { digest: vi.fn(async () => new ArrayBuffer(32)) },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 201 })),
  );
  attached = {
    mediaObjectId: 'm-old',
    processingStatus: 'READY',
    rejectionReason: null,
    uploadExpiresAt: null,
    logo: logoView(OLD_THUMB),
    tenantVersion: 4,
  };
  active = [];
  apiMock();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TenantLogoCard lifecycle', () => {
  it('keeps the old logo visible while a replacement processes, then persists and clears', async () => {
    active = [
      {
        mediaObjectId: 'm-new',
        processingStatus: 'PENDING_PROCESSING',
        rejectionReason: null,
        uploadExpiresAt: new Date(Date.now() + 300_000).toISOString(),
        logo: null,
        tenantVersion: 4,
      },
      {
        mediaObjectId: 'm-new',
        processingStatus: 'READY',
        rejectionReason: null,
        uploadExpiresAt: null,
        logo: logoView('https://cdn.example.test/new/320x320.webp'),
        tenantVersion: 4,
      },
    ];
    sessionStorage.setItem(LEGACY_STORAGE_KEY, 'legacy-id');

    const { container } = renderCard();
    expect(await screen.findByRole('img', { name: 'Restaurant logo' })).toHaveAttribute(
      'src',
      OLD_THUMB,
    );

    pick(container);

    // Finalized: processing is reported while the OLD thumbnail stays up.
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
    expect(screen.getByRole('img', { name: 'Restaurant logo' })).toHaveAttribute('src', OLD_THUMB);
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe('m-new');
    expect(sessionStorage.getItem(LEGACY_STORAGE_KEY)).toBeNull();

    // Next poll reports READY: attached view is refetched, storage is cleared.
    const attachedCallsBefore = statusCalls();
    await waitFor(() => expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull(), {
      timeout: 6000,
    });
    await waitFor(() => expect(statusCalls()).toBeGreaterThan(attachedCallsBefore));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  }, 15_000);

  it('recovers a stored processing upload after a refresh', async () => {
    sessionStorage.setItem(STORAGE_KEY, 'm-stored');
    active = [
      {
        mediaObjectId: 'm-stored',
        processingStatus: 'PENDING_PROCESSING',
        rejectionReason: null,
        uploadExpiresAt: new Date(Date.now() + 300_000).toISOString(),
        logo: null,
        tenantVersion: 4,
      },
      {
        mediaObjectId: 'm-stored',
        processingStatus: 'READY',
        rejectionReason: null,
        uploadExpiresAt: null,
        logo: null,
        tenantVersion: 4,
      },
    ];

    renderCard();

    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
    expect(mockApiRequest.mock.calls.some(([url]) => url.includes('m-stored'))).toBe(true);
    expect(screen.getByRole('img', { name: 'Restaurant logo' })).toHaveAttribute('src', OLD_THUMB);

    await waitFor(() => expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull(), {
      timeout: 6000,
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  }, 15_000);

  it('drops a stored upload whose PENDING_UPLOAD window expired so controls cannot stick', async () => {
    sessionStorage.setItem(STORAGE_KEY, 'm-stuck');
    active = [
      {
        mediaObjectId: 'm-stuck',
        processingStatus: 'PENDING_UPLOAD',
        rejectionReason: null,
        uploadExpiresAt: new Date(Date.now() - 60_000).toISOString(),
        logo: null,
        tenantVersion: 4,
      },
    ];

    renderCard();

    await waitFor(() => expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull());
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await waitFor(() => {
      const replace = screen.getByRole('button', { name: /Upload|Replace/ });
      expect(replace).toBeEnabled();
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows the rejection reason for a rejected upload without locking the controls', async () => {
    sessionStorage.setItem(STORAGE_KEY, 'm-bad');
    active = [
      {
        mediaObjectId: 'm-bad',
        processingStatus: 'REJECTED',
        rejectionReason: 'VIRUS',
        uploadExpiresAt: null,
        logo: null,
        tenantVersion: 4,
      },
    ];

    renderCard();

    await waitFor(() => expect(screen.getByText(/VIRUS/)).toBeInTheDocument());
    const replace = screen.getByRole('button', { name: /Upload|Replace/ });
    await waitFor(() => expect(replace).toBeEnabled());
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe('m-bad');
  });

  it('never persists the active upload when the transport fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500 })),
    );
    active = [
      {
        mediaObjectId: 'm-new',
        processingStatus: 'PENDING_UPLOAD',
        rejectionReason: null,
        uploadExpiresAt: new Date(Date.now() + 300_000).toISOString(),
        logo: null,
        tenantVersion: 4,
      },
    ];

    const { container } = renderCard();
    await screen.findByRole('img', { name: 'Restaurant logo' });
    pick(container);

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
