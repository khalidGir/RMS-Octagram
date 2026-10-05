'use client';

import { useEffect, useRef, useState } from 'react';
import Cropper, { type Area } from 'react-easy-crop';
import { RotateCcw, Upload, X } from 'lucide-react';
import type { MenuImageDraft } from '@/lib/menu-image';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';
import { useLocale } from './locale-provider';

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export function MenuImageEditor({ value, onChange, disabled = false }: { value: MenuImageDraft | null; onChange: (value: MenuImageDraft | null) => void; disabled?: boolean }) {
  const { tr } = useLocale();
  // The crop dialog only opens for a newly chosen file. Mounting with an
  // existing value must show the preview, not pop the cropper immediately.
  const [source, setSource] = useState<{ file: File; url: string } | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(value?.crop.rotation ?? 0);
  const [area, setArea] = useState<Area | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);

  // Blob URLs this editor instance created. Owned URLs are revoked when they
  // stop being displayed (replaced/removed) and on unmount, so a dialog
  // session never leaks object URLs.
  const ownedUrls = useRef<Set<string>>(new Set());
  const previousValue = useRef<MenuImageDraft | null>(value);
  const previousSource = useRef<string | null>(source?.url ?? null);

  function own(url: string) {
    ownedUrls.current.add(url);
    return url;
  }
  function release(url: string | null | undefined) {
    if (url && ownedUrls.current.delete(url)) URL.revokeObjectURL(url);
  }

  useEffect(() => {
    if (previousValue.current !== value) {
      const previous = previousValue.current;
      if (previous && previous.previewUrl !== value?.previewUrl) release(previous.previewUrl);
      previousValue.current = value;
    }
    const currentSource = source?.url ?? null;
    if (previousSource.current !== currentSource) {
      const previous = previousSource.current;
      previousSource.current = currentSource;
      if (previous && previous !== value?.previewUrl) release(previous);
    }
  });

  useEffect(() => () => {
    for (const url of ownedUrls.current) URL.revokeObjectURL(url);
    ownedUrls.current.clear();
  }, []);

  function choose(file?: File) {
    if (!file) return;
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setPickError(tr('menu.imageInvalidType'));
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setPickError(tr('menu.imageTooLarge'));
      return;
    }
    setPickError(null);
    setSource({ file, url: own(URL.createObjectURL(file)) });
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setRotation(0);
    setArea(null);
  }
  function confirm() {
    if (!source || !area) return;
    onChange({ file: source.file, previewUrl: source.url, crop: { x: area.x / 100, y: area.y / 100, width: area.width / 100, height: area.height / 100, rotation } });
    setSource(null);
  }

  return <div className="rounded-2xl border border-line bg-surface p-4">
    <div className="flex items-center justify-between gap-3"><div><p className="text-sm font-black">{tr('menu.photo')}</p><p className="mt-1 text-xs text-ink-muted">{tr('menu.photoHint')}</p></div>{value && <button type="button" disabled={disabled} onClick={() => onChange(null)} className="min-h-11 rounded-xl border border-line px-3 text-xs font-bold"><X className="me-1 inline size-4" />{tr('menu.removePhoto')}</button>}</div>
    {value ? <img src={value.previewUrl} alt={tr('menu.photoPreview')} className="mt-3 aspect-[4/3] w-full max-w-sm rounded-xl object-cover" /> : <>
      <label className="mt-3 grid min-h-28 cursor-pointer place-items-center rounded-xl border-2 border-dashed border-line bg-white p-4 text-center"><input type="file" accept={ACCEPTED_TYPES.join(',')} className="sr-only" disabled={disabled} onChange={(event) => choose(event.target.files?.[0])} /><span><Upload className="mx-auto mb-2 size-5" /><span className="text-sm font-bold">{tr('menu.choosePhoto')}</span></span></label>
      {pickError && <p role="alert" className="mt-2 text-xs font-bold text-red-700">{pickError}</p>}
    </>}
    <Dialog open={Boolean(source)} onOpenChange={(open) => { if (!open) setSource(null); }}><DialogContent className="max-w-2xl" aria-label={tr('menu.cropPhoto')}><DialogTitle>{tr('menu.cropPhoto')}</DialogTitle><div className="relative mt-4 h-80 overflow-hidden rounded-xl bg-black">{source && <Cropper image={source.url} crop={crop} zoom={zoom} rotation={rotation} aspect={4 / 3} onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={(percentage) => setArea(percentage)} />}</div><label className="mt-4 block text-sm font-bold">{tr('menu.zoom')}<input type="range" min="1" max="3" step="0.05" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} className="mt-2 w-full" /></label><div className="mt-4 flex flex-wrap justify-end gap-2"><button type="button" onClick={() => setRotation((current) => (current + 90) % 360)} className="min-h-11 rounded-xl border border-line px-4 font-bold"><RotateCcw className="me-2 inline size-4" />{tr('menu.rotate')}</button><button type="button" onClick={() => setSource(null)} className="min-h-11 rounded-xl border border-line px-4 font-bold">{tr('common.cancel')}</button><button type="button" onClick={confirm} className="min-h-11 rounded-xl bg-brand px-5 font-black text-white">{tr('menu.usePhoto')}</button></div></DialogContent></Dialog>
  </div>;
}
