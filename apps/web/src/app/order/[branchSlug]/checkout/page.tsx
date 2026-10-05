import { PublicCheckout } from '@/components/public-checkout';

export default async function Page({ params }: { params: Promise<{ branchSlug: string }> }) {
  const { branchSlug } = await params;
  return <PublicCheckout expectedEntry={{ kind: 'pickup', publicSlug: branchSlug }} />;
}
