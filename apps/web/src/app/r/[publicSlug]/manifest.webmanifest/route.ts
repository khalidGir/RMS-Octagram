import { NextResponse, type NextRequest } from 'next/server';
import { serverApi, ServerApiError } from '@/lib/server-api';
import {
  buildTenantManifest,
  MANIFEST_CACHE_CONTROL,
  MANIFEST_CONTENT_TYPE,
  restaurantManifestTargets,
} from '@/lib/tenant-manifest';
import type { PublicRestaurantContext } from '@/lib/types';

function manifestResponse(manifest: ReturnType<typeof buildTenantManifest>): NextResponse {
  return new NextResponse(JSON.stringify(manifest), {
    status: 200,
    headers: { 'Content-Type': MANIFEST_CONTENT_TYPE, 'Cache-Control': MANIFEST_CACHE_CONTROL },
  });
}

function errorResponse(status: number): NextResponse {
  return new NextResponse(null, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ publicSlug: string }> },
) {
  const { publicSlug } = await params;
  let context: PublicRestaurantContext;
  try {
    context = await serverApi.get<PublicRestaurantContext>(
      `/public/restaurants/${encodeURIComponent(publicSlug)}`,
    );
  } catch (error) {
    if (error instanceof ServerApiError && error.isNotFound) return errorResponse(404);
    return errorResponse(503);
  }

  return manifestResponse(
    buildTenantManifest(
      { name: context.tenant.name, logo: context.logo },
      restaurantManifestTargets(publicSlug),
    ),
  );
}
