import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { LocaleProvider } from './locale-provider';
import { LegalDoc } from './legal-site';

function renderTerms() {
  return render(<LocaleProvider><LegalDoc doc="terms" /></LocaleProvider>);
}

describe('localized legal documents', () => {
  beforeEach(() => {
    localStorage.clear();
    document.cookie = 'rms-locale=; path=/; max-age=0';
  });

  it('marks Arabic legal copy as unreviewed and exposes authoritative English', async () => {
    localStorage.setItem('rms-locale', 'ar');
    renderTerms();

    await screen.findByRole('heading', { name: 'شروط الخدمة' });
    expect(screen.getByRole('note')).toHaveTextContent('الوثيقة الإنجليزية هي المعتمدة');

    fireEvent.click(screen.getByRole('button', { name: 'عرض النسخة الإنجليزية المعتمدة' }));
    expect(screen.getByRole('heading', { name: 'Terms of Service' })).toBeInTheDocument();
    expect(localStorage.getItem('rms-locale')).toBe('ar');
    await waitFor(() => expect(document.documentElement.lang).toBe('ar'));
  });

  it('does not show a draft warning for English', async () => {
    renderTerms();
    await screen.findByRole('heading', { name: 'Terms of Service' });
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });
});
