import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'RMS Restaurant Operations',
    short_name: 'RMS',
    description: 'Restaurant operations, POS, kitchen, and inventory.',
    start_url: '/login',
    display: 'standalone',
    background_color: '#f6f3ed',
    theme_color: '#121816',
    orientation: 'any',
    categories: ['food', 'business'],
    icons: [
      { src: '/icons/app-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
