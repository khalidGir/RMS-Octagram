import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider, useLocale, type MessageKey } from './locale-provider';

const wrapper = ({ children }: { children: React.ReactNode }) => <LocaleProvider>{children}</LocaleProvider>;

const originalLanguages = navigator.languages;

function stubLanguages(languages: string[]) {
  Object.defineProperty(window.navigator, 'languages', { value: languages, configurable: true });
}

describe('LocaleProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    document.cookie = 'rms-locale=; max-age=0; path=/';
    document.documentElement.lang = 'en';
    document.documentElement.dir = 'ltr';
  });

  afterEach(() => {
    stubLanguages([...originalLanguages]);
    vi.restoreAllMocks();
  });

  it('defaults to English with LTR', async () => {
    const { result } = renderHook(() => useLocale(), { wrapper });
    await waitFor(() => expect(document.documentElement.lang).toBe('en'));
    expect(result.current.locale).toBe('en');
    expect(result.current.direction).toBe('ltr');
    expect(result.current.tr('navigation.signOut')).toBe('Sign out');
  });

  it('switches Arabic into RTL and persists the choice', async () => {
    const { result } = renderHook(() => useLocale(), { wrapper });
    await waitFor(() => expect(result.current.locale).toBe('en'));
    act(() => result.current.setLocale('ar'));

    await waitFor(() => expect(document.documentElement.dir).toBe('rtl'));
    expect(document.documentElement.lang).toBe('ar');
    expect(localStorage.getItem('rms-locale')).toBe('ar');
    expect(document.cookie).toContain('rms-locale=ar');
    expect(result.current.tr('navigation.signOut')).toBe('تسجيل الخروج');
  });

  it('keeps Amharic left-to-right and interpolates values', async () => {
    const { result } = renderHook(() => useLocale(), { wrapper });
    await waitFor(() => expect(result.current.locale).toBe('en'));
    act(() => result.current.setLocale('am'));

    await waitFor(() => expect(document.documentElement.lang).toBe('am'));
    expect(document.documentElement.dir).toBe('ltr');
    expect(result.current.tr('ordering.table', { table: 8 })).toContain('8');
  });

  it('restores a previously saved locale', async () => {
    localStorage.setItem('rms-locale', 'ar');
    const { result } = renderHook(() => useLocale(), { wrapper });
    await waitFor(() => expect(result.current.locale).toBe('ar'));
    expect(document.documentElement.dir).toBe('rtl');
  });

  it('migrates the legacy rms-public-locale key', async () => {
    localStorage.setItem('rms-public-locale', 'am');
    const { result } = renderHook(() => useLocale(), { wrapper });
    await waitFor(() => expect(result.current.locale).toBe('am'));
    expect(localStorage.getItem('rms-locale')).toBe('am');
    expect(localStorage.getItem('rms-public-locale')).toBeNull();
  });

  it('honours the locale cookie when storage is empty', async () => {
    document.cookie = 'rms-locale=ar; path=/';
    const { result } = renderHook(() => useLocale(), { wrapper });
    await waitFor(() => expect(result.current.locale).toBe('ar'));
  });

  it('falls back to the browser language when nothing is saved', async () => {
    stubLanguages(['am-ET', 'en-US']);
    const { result } = renderHook(() => useLocale(), { wrapper });
    await waitFor(() => expect(result.current.locale).toBe('am'));
  });

  it('falls back to English for unsupported browser languages', async () => {
    stubLanguages(['fr-FR']);
    const { result } = renderHook(() => useLocale(), { wrapper });
    await waitFor(() => expect(result.current.locale).toBe('en'));
  });

  it('selects plural forms and warns on missing keys', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { result } = renderHook(() => useLocale(), { wrapper });
    await waitFor(() => expect(result.current.locale).toBe('en'));

    expect(result.current.tr('ordering.reviewOrderCount', { count: 1 })).toBe('Review order · 1 item');
    expect(result.current.tr('ordering.reviewOrderCount', { count: 3 })).toBe('Review order · 3 items');

    const missing = result.current.tr('ordering.doesNotExist' as MessageKey);
    expect(missing).toBe('ordering.doesNotExist');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ordering.doesNotExist'));
  });

  it('formats currency, numbers, and times with the locale intl profile', async () => {
    const { result } = renderHook(() => useLocale(), { wrapper });
    await waitFor(() => expect(result.current.locale).toBe('en'));

    expect(result.current.formatCurrency('123456')).toBe('ETB 1,234.56');
    expect(result.current.formatCurrency(500n)).toBe('ETB 5');
    expect(result.current.formatNumber(1234567)).toBe('1,234,567');
    expect(result.current.formatDate(Date.UTC(2026, 9, 2, 10), { dateStyle: 'medium' })).toBe('Oct 2, 2026');
    expect(result.current.formatTime(Date.UTC(2026, 9, 2, 7, 5))).toMatch(/10:05|10\.05/);
  });
});
