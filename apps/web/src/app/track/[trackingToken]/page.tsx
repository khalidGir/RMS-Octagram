import { OrderTracking } from '@/components/order-tracking';
export default async function Page({ params }: { params: Promise<{ trackingToken: string }> }) { const { trackingToken } = await params; return <OrderTracking token={trackingToken} />; }
