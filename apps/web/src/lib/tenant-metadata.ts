import type { Metadata } from 'next';
import { serverApi } from './server-api';
import type { PublicRestaurantContext, PublicTableContext, TenantLogoView } from './types';

function brandingMetadata(
  name: string,
  logo: TenantLogoView | null,
  manifestHref: string,
): Metadata {
  return {
    title: { absolute: name },
    applicationName: name,
    manifest: manifestHref,
    appleWebApp: { capable: true, title: name, statusBarStyle: 'black-translucent' },
    ...(logo
      ? { icons: { apple: [{ url: logo.apple180, sizes: '180x180', type: 'image/png' }] } }
      : {}),
  };
}

/** Metadata for the pickup route; falls back to root defaults when the API is unavailable. */
export async function pickupBrandingMetadata(publicSlug: string): Promise<Metadata> {
  try {
    const context = await serverApi.get<PublicRestaurantContext>(
      `/public/restaurants/${encodeURIComponent(publicSlug)}`,
    );
    return brandingMetadata(
      context.tenant.name,
      context.logo,
      `/r/${encodeURIComponent(publicSlug)}/manifest.webmanifest`,
    );
  } catch {
    return {};
  }
}

/**
 * Metadata for the table route. The manifest link points at the branch pickup
 * manifest when a slug exists so the installed app carries no session token;
 * otherwise at a token-scoped manifest route whose content still never
 * contains the token.
 */
export async function tableBrandingMetadata(token: string): Promise<Metadata> {
  try {
    const context = await serverApi.post<PublicTableContext>('/public/table-context/resolve', {
      token,
    });
    const slug = context.branch.publicSlug;
    const manifestHref = slug
      ? `/r/${encodeURIComponent(slug)}/manifest.webmanifest`
      : `/o/${encodeURIComponent(token)}/manifest.webmanifest`;
    return brandingMetadata(context.tenant.name, context.logo, manifestHref);
  } catch {
    return {};
  }
}
