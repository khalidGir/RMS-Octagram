import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'RMS Restaurant Operations', short_name: 'RMS', description: 'Restaurant operations, POS, kitchen, and inventory.',
    start_url: '/login', display: 'standalone', background_color: '#f6f3ed', theme_color: '#121816', orientation: 'any',
    icons: [{ src: '/icons/app-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
  };
}
