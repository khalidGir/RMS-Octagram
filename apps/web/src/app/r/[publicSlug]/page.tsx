import type { Metadata } from 'next';
import { PublicOrderMenu } from '@/components/public-order-menu';
import { pickupBrandingMetadata } from '@/lib/tenant-metadata';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ publicSlug: string }>;
}): Promise<Metadata> {
  const { publicSlug } = await params;
  return pickupBrandingMetadata(publicSlug);
}

export default async function PickupEntryPage({
  params,
}: {
  params: Promise<{ publicSlug: string }>;
}) {
  const { publicSlug } = await params;
  return <PublicOrderMenu entry={{ kind: 'pickup', publicSlug }} />;
}
