import { PublicOrderMenu } from '@/components/public-order-menu';

export default async function PickupEntryPage({ params }: { params: Promise<{ publicSlug: string }> }) {
  const { publicSlug } = await params;
  return <PublicOrderMenu entry={{ kind: 'pickup', publicSlug }} />;
}
