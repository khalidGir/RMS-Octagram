import { StaffShell } from '@/components/staff-shell';
import { OrderDetail } from '@/components/order-detail';

export default function Page({ params }: { params: Promise<{ orderId: string }> }) {
  return (
    <StaffShell>
      <OrderDetailWrapper params={params} />
    </StaffShell>
  );
}

async function OrderDetailWrapper({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  return <OrderDetail orderId={orderId} />;
}
