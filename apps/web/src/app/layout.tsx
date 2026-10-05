import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { Providers } from '@/components/providers';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

// Pre-paint locale boot: runs while the HTML is still parsing, so returning
// users see the right <html lang/dir> (and fonts) on the very first paint
// instead of an English LTR flash. Values are STRICTLY validated against the
// supported locale allow-list — an arbitrary stored value is never written to
// lang or dir; anything unrecognized falls back to 'en'.
const LOCALE_BOOT_SCRIPT = `(function () {
  function valid(value) { return value === 'en' || value === 'am' || value === 'ar'; }
  var pick = null;
  try {
    var stored = window.localStorage.getItem('rms-locale');
    if (valid(stored)) pick = stored;
    if (!pick) {
      var legacy = window.localStorage.getItem('rms-public-locale');
      if (valid(legacy)) pick = legacy;
    }
    if (!pick) {
      var match = document.cookie.match(/(?:^|; *)rms-locale=([^;]*)/);
      if (match) {
        var decoded = '';
        try { decoded = decodeURIComponent(match[1]); } catch (e) {}
        if (valid(decoded)) pick = decoded;
      }
    }
    if (!pick && window.navigator) {
      var langs = window.navigator.languages || [window.navigator.language];
      for (var i = 0; i < langs.length && !pick; i++) {
        var short = String(langs[i] || '').toLowerCase().split('-')[0];
        if (valid(short)) pick = short;
      }
    }
  } catch (e) {}
  if (!valid(pick)) pick = 'en';
  document.documentElement.lang = pick;
  document.documentElement.dir = pick === 'ar' ? 'rtl' : 'ltr';
  try {
    window.localStorage.setItem('rms-locale', pick);
    window.localStorage.removeItem('rms-public-locale');
    document.cookie = 'rms-locale=' + pick + '; path=/; max-age=31536000; samesite=lax';
  } catch (e) {}
})();`;

export const metadata: Metadata = {
  title: { default: 'RestaurantMS', template: '%s · RestaurantMS' },
  description: 'Restaurant operations, point of sale, kitchen, payments, and inventory for modern hospitality teams.',
  applicationName: 'RestaurantMS',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'RMS' },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#1d1d1f' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr" className={inter.variable} suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: LOCALE_BOOT_SCRIPT }} />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
