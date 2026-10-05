import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from './locale-provider';
import { PublicOrderMenu } from './public-order-menu';
import type * as ApiClient from '@/lib/api-client';

const apiRequestMock = vi.hoisted(() => vi.fn());
const routerPushMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: routerPushMock }),
}));

vi.mock('@/lib/api-client', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof ApiClient;
  return { ...actual, apiRequest: apiRequestMock };
});

vi.mock('@/lib/public-menu', () => ({
  normalizePublicMenu: (menu: unknown) => menu,
}));

const fixture = {
  tenant: { id: 't1', name: 'Unity Diner' },
  branch: { id: 'b1', name: 'Bole Branch' },
  categories: [
    {
      id: 'c1',
      name: 'Lunch specials',
      items: [
        {
          id: 'i1',
          name: 'Misir Wot',
          description: 'Spicy lentils',
          variants: [{ id: 'v1', name: 'Regular', basePriceMinor: '12000', isDefault: true }],
          modifierGroups: [],
        },
      ],
    },
  ],
  context: {
    tenant: { id: 't1', name: 'Unity Diner' },
    branch: { id: 'b1', name: 'Bole Branch' },
    publicSlug: 'unity',
    pickupEnabled: true,
    availablePaymentMethods: ['cash'],
  },
};

function renderMenu(locale?: 'am' | 'ar') {
  if (locale) localStorage.setItem('rms-locale', locale);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <LocaleProvider>
      <QueryClientProvider client={queryClient}>
        <PublicOrderMenu entry={{ kind: 'pickup', publicSlug: 'unity' }} />
      </QueryClientProvider>
    </LocaleProvider>,
  );
}

beforeEach(() => {
  apiRequestMock.mockReset().mockResolvedValue({ data: fixture });
  routerPushMock.mockReset();
  localStorage.clear();
  window.sessionStorage.clear();
  document.cookie = 'rms-locale=; path=/; max-age=0';
  document.documentElement.lang = 'en';
  document.documentElement.dir = 'ltr';
});

describe('public order menu localization', () => {
  it('keeps the English chrome while leaving tenant menu content untouched', async () => {
    renderMenu();
    expect(await screen.findByRole('heading', { level: 1, name: 'Choose your meal' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Menu categories' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Language' })).toBeInTheDocument();
    expect(screen.getByText('Unity Diner')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Lunch specials' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Misir Wot' })).toBeInTheDocument();
  });

  it('localizes the chrome to Amharic while tenant content stays in its original language', async () => {
    renderMenu('am');
    expect(await screen.findByRole('heading', { level: 1, name: 'ምግብዎን ይምረጡ' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'የምናሌ ምድቦች' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ጨምር' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'ቋንቋ' })).toBeInTheDocument();
    expect(screen.getByText('Unity Diner')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Lunch specials' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Misir Wot' })).toBeInTheDocument();
  });

  it('localizes the chrome to Arabic and flips the document to RTL', async () => {
    renderMenu('ar');
    expect(await screen.findByRole('heading', { level: 1, name: 'اختر وجبتك' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'فئات القائمة' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'إضافة' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'اللغة' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Misir Wot' })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');
  });

  it('shows the localized pluralized review label after adding an item in English', async () => {
    renderMenu();
    await screen.findByRole('heading', { level: 1, name: 'Choose your meal' });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByRole('button', { name: /Review order · 1 item/ })).toBeInTheDocument();
  });

  it('navigates to checkout with the Next router so locale and cart survive', async () => {
    renderMenu();
    await screen.findByRole('heading', { level: 1, name: 'Choose your meal' });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    fireEvent.click(await screen.findByRole('button', { name: /Review order · 1 item/ }));
    expect(routerPushMock).toHaveBeenCalledWith('/r/unity/checkout');
    expect(JSON.parse(window.sessionStorage.getItem('rms-public-cart') ?? '{}').lines).toHaveLength(1);
  });

  it('shows the pluralized review label in Amharic after adding an item', async () => {
    renderMenu('am');
    await screen.findByRole('heading', { level: 1, name: 'ምግብዎን ይምረጡ' });
    fireEvent.click(screen.getByRole('button', { name: 'ጨምር' }));
    expect(await screen.findByRole('button', { name: /ትእዛዙን ይመልከቱ · 1 ዕቃ/ })).toBeInTheDocument();
  });
});
