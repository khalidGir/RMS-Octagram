import { PublicCheckout } from '@/components/public-checkout';
export default async function Page({ params }: { params: Promise<{ token: string }> }) { const { token } = await params; return <PublicCheckout expectedEntry={{ kind: 'table', token }} />; }
