import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as baseRender, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '@/components/locale-provider';
import { apiRequest } from '@/lib/api-client';
import type * as ApiClient from '@/lib/api-client';
import { uploadMenuImage } from '@/lib/menu-image';
import type * as MenuImageModule from '@/lib/menu-image';
import { MenuManagement } from './menu-management';

const control = vi.hoisted(() => ({ photoFails: false }));

vi.mock('@/lib/api-client', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof ApiClient;
  return { ...actual, apiRequest: vi.fn() };
});

vi.mock('@/components/auth-provider', () => ({
  useAuth: () => ({
    accessToken: 'test-token',
    csrfToken: 'csrf',
    profile: { memberships: [{ tenant: { id: 't1' }, role: 'OWNER', branchAssignments: [] }] },
  }),
}));

vi.mock('@/lib/menu-image', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof MenuImageModule;
  return {
    ...actual,
    uploadMenuImage: vi.fn(async () => {
      if (control.photoFails) throw new Error('photo upload failed');
      return undefined;
    }),
  };
});

// The create-flow notice under test lives in MenuManagement; the editor only
// needs to hand a valid draft to the parent so uploadMenuImage gets called.
vi.mock('./menu-image-editor', () => ({
  MenuImageEditor: ({
    value,
    onChange,
    disabled,
  }: {
    value: { file: File; previewUrl: string } | null;
    onChange: (draft: { file: File; previewUrl: string; crop: { x: number; y: number; width: number; height: number; rotation: number } } | null) => void;
    disabled?: boolean;
  }) =>
    value ? (
      <div>
        <span>photo attached</span>
        <button type="button" disabled={disabled} onClick={() => onChange(null)}>
          clear photo
        </button>
      </div>
    ) : (
      <button
        type="button"
        disabled={disabled}
        onClick={() =>
          onChange({
            file: new File(['x'], 'photo.jpg', { type: 'image/jpeg' }),
            previewUrl: 'blob:draft',
            crop: { x: 0, y: 0, width: 1, height: 1, rotation: 0 },
          })
        }
      >
        attach photo
      </button>
    ),
}));

const mockApiRequest = vi.mocked(apiRequest);
const mockUploadMenuImage = vi.mocked(uploadMenuImage);

function mockLists() {
  return async (url: string, options?: { method?: string }) => {
    if (url === '/categories') return { data: [{ id: 'cat-1', name: 'Mains', sortOrder: 0, isActive: true }] };
    if (url === '/items' && (!options?.method || options.method === 'GET')) return { data: [] };
    if (url === '/items' && options?.method === 'POST') return { data: { id: 'item-1', version: 1 } };
    if (url === '/items/item-1/variants' && options?.method === 'POST') return { data: { id: 'var-1' } };
    return { data: {} };
  };
}

function renderMenu() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return baseRender(
    <LocaleProvider>
      <QueryClientProvider client={qc}>
        <MenuManagement />
      </QueryClientProvider>
    </LocaleProvider>,
  );
}

async function openCreateDialog() {
  await screen.findByText('Your menu is empty');
  fireEvent.click(screen.getByRole('button', { name: '+ Add menu item' }));
  await screen.findByPlaceholderText('e.g. Doro Wot');
  fireEvent.change(screen.getByPlaceholderText('e.g. Doro Wot'), { target: { value: 'Shiro Wot' } });
  fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '150' } });
}

function submitCreate() {
  fireEvent.click(screen.getByRole('button', { name: 'Add menu item' }));
}

describe('MenuManagement create notices', () => {
  beforeEach(() => {
    control.photoFails = false;
    mockApiRequest.mockReset();
    mockApiRequest.mockImplementation(mockLists() as never);
    // mockClear (not mockReset): keep the factory implementation that reads
    // control.photoFails, only drop call history between tests.
    mockUploadMenuImage.mockClear();
  });

  it('shows the added notice after a photo upload succeeds and passes the created item to the uploader', async () => {
    renderMenu();
    await openCreateDialog();
    fireEvent.click(screen.getByRole('button', { name: 'attach photo' }));
    submitCreate();

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Shiro Wot was added to the menu.'));
    expect(mockUploadMenuImage).toHaveBeenCalledTimes(1);
    expect(mockUploadMenuImage).toHaveBeenCalledWith(
      expect.objectContaining({
        itemId: 'item-1',
        version: 1,
        accessToken: 'test-token',
        csrfToken: 'csrf',
        tenantId: 't1',
        draft: expect.objectContaining({ previewUrl: 'blob:draft' }),
      }),
    );
  });

  it('shows the photo-failed-saved notice when the upload fails after the item was created', async () => {
    control.photoFails = true;
    renderMenu();
    await openCreateDialog();
    fireEvent.click(screen.getByRole('button', { name: 'attach photo' }));
    submitCreate();

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'The item was saved, but its photo could not be uploaded. Open the item to retry.',
      ),
    );
    expect(mockUploadMenuImage).toHaveBeenCalledTimes(1);
  });

  it('shows the added notice without calling the uploader when no photo is attached', async () => {
    renderMenu();
    await openCreateDialog();
    submitCreate();

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Shiro Wot was added to the menu.'));
    expect(mockUploadMenuImage).not.toHaveBeenCalled();
  });
});
