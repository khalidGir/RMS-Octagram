import type { Metadata } from 'next';
import { PublicOrderMenu } from '@/components/public-order-menu';
import { tableBrandingMetadata } from '@/lib/tenant-metadata';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  return tableBrandingMetadata(token);
}

export default async function TableEntryPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <PublicOrderMenu entry={{ kind: 'table', token }} />;
}
