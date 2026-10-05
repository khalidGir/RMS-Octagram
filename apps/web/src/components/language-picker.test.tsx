import { describe, it, expect, beforeEach } from 'vitest';
import { render as baseRender, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { LocaleProvider } from './locale-provider';
import { LanguagePicker } from './language-picker';

const render = (ui: React.ReactElement) => baseRender(<LocaleProvider>{ui}</LocaleProvider>);

beforeEach(() => {
  localStorage.clear();
  document.cookie = 'rms-locale=; path=/; max-age=0';
  document.documentElement.lang = 'en';
  document.documentElement.dir = 'ltr';
  window.HTMLElement.prototype.hasPointerCapture ??= () => false;
  window.HTMLElement.prototype.setPointerCapture ??= () => {};
  window.HTMLElement.prototype.releasePointerCapture ??= () => {};
});

describe('LanguagePicker', () => {
  it('labels the control in English and keeps a touch-sized trigger', () => {
    render(<LanguagePicker />);
    const trigger = screen.getByRole('combobox', { name: 'Language' });
    expect(trigger).toHaveClass('min-h-11');
  });

  it('labels the control in Amharic when Amharic is active', () => {
    localStorage.setItem('rms-locale', 'am');
    render(<LanguagePicker />);
    expect(screen.getByRole('combobox', { name: 'ቋንቋ' })).toBeInTheDocument();
  });

  it('labels the control in Arabic when Arabic is active', () => {
    localStorage.setItem('rms-locale', 'ar');
    render(<LanguagePicker />);
    expect(screen.getByRole('combobox', { name: 'اللغة' })).toBeInTheDocument();
  });

  it('offers all three languages under their native names with lang and dir hints', async () => {
    render(<LanguagePicker />);
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowDown' });
    const listbox = await screen.findByRole('listbox');
    const options = within(listbox).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['English', 'አማርኛ', 'العربية']);
    expect(within(listbox).getByText('አማርኛ')).toHaveAttribute('lang', 'am');
    expect(within(listbox).getByText('አማርኛ')).toHaveAttribute('dir', 'ltr');
    expect(within(listbox).getByText('العربية')).toHaveAttribute('dir', 'rtl');
  });

  it('switches to Amharic, persists it, and stays left-to-right', async () => {
    render(<LanguagePicker />);
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowDown' });
    const listbox = await screen.findByRole('listbox');
    fireEvent.click(within(listbox).getByText('አማርኛ'));
    await waitFor(() => expect(localStorage.getItem('rms-locale')).toBe('am'));
    expect(document.cookie).toContain('rms-locale=am');
    expect(document.documentElement.lang).toBe('am');
    expect(document.documentElement.dir).toBe('ltr');
    expect(screen.getByRole('combobox', { name: 'ቋንቋ' })).toBeInTheDocument();
  });

  it('switches to Arabic, persists it, and flips the document to RTL', async () => {
    render(<LanguagePicker />);
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowDown' });
    const listbox = await screen.findByRole('listbox');
    fireEvent.click(within(listbox).getByText('العربية'));
    await waitFor(() => expect(localStorage.getItem('rms-locale')).toBe('ar'));
    expect(document.cookie).toContain('rms-locale=ar');
    expect(document.documentElement.lang).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');
    expect(screen.getByRole('combobox', { name: 'اللغة' })).toBeInTheDocument();
  });
});
