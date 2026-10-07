import { NextResponse, type NextRequest } from 'next/server';
import { serverApi, ServerApiError } from '@/lib/server-api';
import {
  buildTenantManifest,
  MANIFEST_CACHE_CONTROL,
  MANIFEST_CONTENT_TYPE,
  restaurantManifestTargets,
  ROOT_MANIFEST_TARGETS,
} from '@/lib/tenant-manifest';
import type { PublicTableContext } from '@/lib/types';

function manifestResponse(manifest: ReturnType<typeof buildTenantManifest>): NextResponse {
  return new NextResponse(JSON.stringify(manifest), {
    status: 200,
    headers: { 'Content-Type': MANIFEST_CONTENT_TYPE, 'Cache-Control': MANIFEST_CACHE_CONTROL },
  });
}

function errorResponse(status: number): NextResponse {
  return new NextResponse(null, { status, headers: { 'Cache-Control': 'no-store' } });
}

/**
 * Table-session manifest. The QR token resolves the restaurant server-side;
 * the manifest itself opens on the branch's pickup URL (`/r/{slug}/`) so no
 * session token is ever baked into an installed app. Branches without a
 * public slug fall back to the site root.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  let context: PublicTableContext;
  try {
    context = await serverApi.post<PublicTableContext>('/public/table-context/resolve', { token });
  } catch (error) {
    if (error instanceof ServerApiError && error.isNotFound) return errorResponse(404);
    return errorResponse(503);
  }

  const slug = context.branch.publicSlug;
  return manifestResponse(
    buildTenantManifest(
      { name: context.tenant.name, logo: context.logo },
      slug ? restaurantManifestTargets(slug) : ROOT_MANIFEST_TARGETS,
    ),
  );
}
