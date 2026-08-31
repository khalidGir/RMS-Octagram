import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { Providers } from '@/components/providers';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'RestaurantMS', template: '%s · RestaurantMS' },
  description: 'Restaurant operations, point of sale, kitchen, payments, and inventory for modern hospitality teams.',
  applicationName: 'RestaurantMS',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'RMS' },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#121816' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en" className={inter.variable}><body><Providers>{children}</Providers></body></html>;
}
