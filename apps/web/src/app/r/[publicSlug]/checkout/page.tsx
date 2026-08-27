import { PublicCheckout } from '@/components/public-checkout';
export default async function Page({ params }: { params: Promise<{ publicSlug: string }> }) { const { publicSlug } = await params; return <PublicCheckout expectedEntry={{ kind: 'pickup', publicSlug }} />; }
