'use client';

import { useState } from 'react';
import type { MenuItemImage } from '@/lib/menu-image';

export function MenuItemPhoto({ image, name, className = '', eager = false }: { image?: MenuItemImage | null; name: string; className?: string; eager?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (!image || failed) return <div role="img" aria-label={name} className={`grid aspect-[4/3] place-items-center bg-gradient-to-br from-brand to-dark text-2xl font-black text-white ${className}`}>{name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</div>;
  return <picture><source media="(min-width: 768px)" srcSet={`${image.standardUrl} 1x, ${image.highResolutionUrl} 2x`} /><img src={image.thumbnailUrl} alt={name} width={image.width} height={image.height} loading={eager ? 'eager' : 'lazy'} decoding="async" onError={() => setFailed(true)} className={`aspect-[4/3] w-full object-cover ${className}`} /></picture>;
}
