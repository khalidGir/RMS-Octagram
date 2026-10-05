import { PublicOrderMenu } from '@/components/public-order-menu';

export const metadata = { title: 'Order from Buna House', description: 'Browse the Buna House menu and place your order.' };

export default async function CustomerOrderPage({ params }: { params: Promise<{ branchSlug: string }> }) {
  const { branchSlug } = await params;
  return <PublicOrderMenu entry={{ kind: 'pickup', publicSlug: branchSlug }} />;
}
