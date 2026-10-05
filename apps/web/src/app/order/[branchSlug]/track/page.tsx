'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { OrderTracking } from '@/components/order-tracking';

export default function TrackPage() {
  const router = useRouter();
  const [trackingToken, setTrackingToken] = useState<string | null>(null);

  useEffect(() => {
    const token = window.sessionStorage.getItem('rms-tracking-token');
    if (token) {
      setTrackingToken(token);
    } else {
      router.replace('/');
    }
  }, [router]);

  if (!trackingToken) return <main className="grid min-h-screen place-items-center p-6 text-center"><div><h1 className="text-2xl font-black">Loading tracking…</h1></div></main>;
  return <OrderTracking token={trackingToken} />;
}
