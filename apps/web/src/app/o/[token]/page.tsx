import { PublicOrderMenu } from '@/components/public-order-menu';

export default async function TableEntryPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <PublicOrderMenu entry={{ kind: 'table', token }} />;
}
