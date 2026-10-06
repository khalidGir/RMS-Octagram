/**
 * URL shapes for tenant-logo derivatives written by the media worker
 * (purpose TENANT_LOGO). Kept in shared so the owner-facing branding
 * service and the public context builder agree on file names.
 */
export interface TenantLogoView {
  icon192: string;
  icon512: string;
  maskable512: string;
  apple180: string;
  thumbnail: string;
}

export function tenantLogoView(
  cdnBase: string,
  cdnKeyBase: string | null | undefined,
  processingStatus: string | null | undefined,
): TenantLogoView | null {
  const base = cdnBase.replace(/\/$/, '');
  if (!base || !cdnKeyBase || processingStatus !== 'READY') return null;
  const root = `${base}/${cdnKeyBase}`;
  return {
    icon192: `${root}/192x192.png`,
    icon512: `${root}/512x512.png`,
    maskable512: `${root}/512x512-maskable.png`,
    apple180: `${root}/180x180.png`,
    thumbnail: `${root}/320x320.webp`,
  };
}
