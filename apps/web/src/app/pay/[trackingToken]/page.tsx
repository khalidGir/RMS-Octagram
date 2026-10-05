import { PaymentProofUpload } from '@/components/payment-proof-upload';
export default async function Page({ params }: { params: Promise<{ trackingToken: string }> }) { const { trackingToken } = await params; return <PaymentProofUpload trackingToken={trackingToken} />; }
