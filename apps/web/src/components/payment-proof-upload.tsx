'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import { ApiError, apiRequest, formatEtbMinor, type ApiEnvelope } from '@/lib/api-client';

interface PaymentOptions { totalMinor: string; currency: string; instructions: Array<{ id: string; method: string; label: string; accountHolder: string; accountIdentifier: string; instructions: string | null }>; }

async function sha256(file: File): Promise<string> { const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer()); return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(''); }

export function PaymentProofUpload({ trackingToken }: { trackingToken: string }) {
  const router = useRouter();
  const [paymentToken, setPaymentToken] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<string | null>(null);
  const [options, setOptions] = useState<PaymentOptions | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [reference, setReference] = useState('');
  const [state, setState] = useState<'idle'|'hashing'|'uploading'|'finalizing'>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setPaymentToken(window.sessionStorage.getItem('rms-payment-token')); setPaymentMethod(window.sessionStorage.getItem('rms-payment-method')); void apiRequest<ApiEnvelope<PaymentOptions>>('/public/payment-options', { method: 'POST', body: { trackingToken } }).then((response) => setOptions(response.data)).catch(() => setError('Payment instructions are unavailable. Please ask restaurant staff for help.')); }, [trackingToken]);

  function choose(next: File | undefined) {
    setError(null);
    if (!next) return setFile(null);
    if (!['image/jpeg','image/png','image/webp'].includes(next.type)) return setError('Choose a JPEG, PNG, or WebP image.');
    if (next.size > 5 * 1024 * 1024) return setError('The image must be 5 MB or smaller.');
    setFile(next);
  }

  async function upload() {
    if (!file || !paymentToken || state !== 'idle') return;
    setError(null);
    try {
      setState('hashing');
      const checksum = await sha256(file);
      const intent = await apiRequest<ApiEnvelope<{ mediaObjectId: string; uploadUrl: string; fields: Record<string,string> }>>('/public/payments/proof-upload', { method: 'POST', body: { paymentToken, contentType: file.type, sizeBytes: file.size, sha256: checksum } });
      setState('uploading');
      const form = new FormData(); Object.entries(intent.data.fields).forEach(([key,value]) => form.append(key,value)); form.append('file', file);
      const uploaded = await fetch(intent.data.uploadUrl, { method: 'POST', body: form });
      if (!uploaded.ok) throw new Error('The image upload failed. Your order was not marked as paid.');
      setState('finalizing');
      await apiRequest('/public/payments/proof-finalize', { method: 'POST', body: { paymentToken, mediaObjectId: intent.data.mediaObjectId, customerReference: reference || undefined } });
      router.replace(`/track/${encodeURIComponent(trackingToken)}` as Route);
    } catch (reason) { setError(reason instanceof ApiError || reason instanceof Error ? reason.message : 'Upload failed. Please retry safely.'); setState('idle'); }
  }

  const instruction = options?.instructions.find((item) => item.method === paymentMethod) ?? options?.instructions[0];
  return <main className="min-h-screen bg-[#fffaf3] px-4 py-8"><section className="mx-auto max-w-2xl rounded-3xl border border-line bg-white p-6 shadow-card sm:p-8"><p className="text-xs font-black uppercase tracking-wider text-brand">Manual transfer</p><h1 className="mt-2 text-3xl font-black">Upload payment proof</h1><p className="mt-2 text-sm leading-6 text-ink-muted">Owner verification is required before your order enters the kitchen.</p>{instruction && <div className="mt-6 rounded-2xl bg-[#14201b] p-5 text-white"><p className="text-xs font-bold text-white/60">Send exactly</p><p className="mt-1 text-2xl font-black" dir="ltr">{formatEtbMinor(options!.totalMinor)}</p><p className="mt-4 font-black">{instruction.label}</p><p className="mt-1 text-sm">{instruction.accountHolder} · <b dir="ltr">{instruction.accountIdentifier}</b></p>{instruction.instructions && <p className="mt-2 text-sm text-white/70">{instruction.instructions}</p>}</div>}
    <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><b>Protect your private information.</b> Crop unrelated balances, messages, and contacts before uploading.</div>
    {error && <div role="alert" className="mt-4 rounded-xl bg-red-50 p-4 text-sm font-bold text-red-800">{error}</div>}
    <label className="mt-5 grid min-h-48 cursor-pointer place-items-center rounded-2xl border-2 border-dashed border-line p-6 text-center"><input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => choose(event.target.files?.[0])} /><div><p className="font-black">{file ? file.name : 'Choose payment screenshot'}</p><p className="mt-1 text-xs text-ink-muted">JPEG, PNG or WebP · maximum 5 MB</p></div></label>
    <label className="mt-5 block text-sm font-bold">Transaction reference (optional)<input value={reference} onChange={(event) => setReference(event.target.value)} maxLength={200} className="mt-2 min-h-12 w-full rounded-xl border border-line px-3" /></label>
    <button onClick={() => void upload()} disabled={!file || !paymentToken || state !== 'idle'} className="mt-5 min-h-14 w-full rounded-xl bg-brand font-black text-white disabled:opacity-50">{state === 'idle' ? 'Submit for verification' : state === 'hashing' ? 'Preparing image…' : state === 'uploading' ? 'Uploading…' : 'Confirming securely…'}</button>
  </section></main>;
}
