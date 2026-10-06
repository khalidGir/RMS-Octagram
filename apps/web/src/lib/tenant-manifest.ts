import type { TenantLogoView } from './types';

export interface TenantManifestIdentity {
  name: string;
  logo: TenantLogoView | null;
}

export interface TenantManifestTargets {
  /** Where the installed app opens. Never a QR session token. */
  startUrl: string;
  /** Stable identity for update detection; same rule as startUrl. */
  id: string;
  scope: string;
}

export interface TenantManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose: 'any' | 'maskable';
}

const DEFAULT_ICONS: TenantManifestIcon[] = [
  { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  { src: '/icons/icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
];

function logoIcons(logo: TenantLogoView): TenantManifestIcon[] {
  return [
    { src: logo.icon192, sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: logo.icon512, sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: logo.maskable512, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ];
}

function shortName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length <= 24) return trimmed;
  return `${trimmed.slice(0, 23).trimEnd()}…`;
}

/**
 * Build a per-restaurant installable manifest. Falls back to the default RMS
 * icons when the restaurant has not uploaded a logo, so the customer route is
 * installable either way.
 */
export function buildTenantManifest(
  identity: TenantManifestIdentity,
  targets: TenantManifestTargets,
) {
  return {
    name: identity.name,
    short_name: shortName(identity.name),
    description: `Order from ${identity.name}.`,
    start_url: targets.startUrl,
    id: targets.id,
    scope: targets.scope,
    display: 'standalone',
    background_color: '#fff8ef',
    theme_color: '#121816',
    orientation: 'any',
    categories: ['food'],
    icons: identity.logo ? logoIcons(identity.logo) : DEFAULT_ICONS,
  };
}

export const MANIFEST_CACHE_CONTROL = 'public, max-age=300, s-maxage=300';
export const MANIFEST_CONTENT_TYPE = 'application/manifest+json; charset=utf-8';
