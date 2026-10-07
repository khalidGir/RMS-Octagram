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

/**
 * Install targets for a restaurant route. start_url, id, and scope are the
 * SAME slash-terminated path: W3C appmanifest §5 matches scope by string
 * prefix, so `/r/{slug}` would also cover `/r/{slug}-annex` — a different
 * restaurant's pages inside the wrong installed app. The slash keeps the
 * prefix segment-boundary safe ("use a scope ending in a /"). §1.6 discards
 * any scope that does not contain start_url, so start_url carries the slash
 * too; src/middleware.ts makes `/r/{slug}/` the canonical, directly served
 * form so the launched document never lands out of scope (ADR-030).
 */
export function restaurantManifestTargets(slug: string): TenantManifestTargets {
  const path = `/r/${slug}/`;
  return { startUrl: path, id: path, scope: path };
}

/** Token-free fallback for branches without a public slug. */
export const ROOT_MANIFEST_TARGETS: TenantManifestTargets = {
  startUrl: '/',
  id: '/',
  scope: '/',
};

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
