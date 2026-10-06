'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import { usePwaInstall } from '@/lib/use-pwa-install';
import { useLocale } from './locale-provider';

/**
 * Customer-facing install affordance. Chromium gets a real install prompt;
 * Safari/iOS gets the native Share → Add to Home Screen instructions in a
 * dismissible hint. Hidden entirely once the app is installed.
 */
export function PwaInstallButton() {
  const { canInstall, installed, iosInstallable, promptInstall } = usePwaInstall();
  const { tr } = useLocale();
  const [showIosHint, setShowIosHint] = useState(false);

  if (installed || (!canInstall && !iosInstallable)) return null;

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        aria-expanded={showIosHint || undefined}
        onClick={() => {
          if (canInstall) {
            void promptInstall();
          } else {
            setShowIosHint((current) => !current);
          }
        }}
        className="inline-flex min-h-10 items-center gap-2 rounded-full border border-[#eadccd] bg-white/90 px-3 text-xs font-black text-[#241812] shadow-[0_6px_18px_rgba(47,35,24,0.10)] transition-colors hover:bg-white"
      >
        <Download className="size-4" aria-hidden />
        {tr('ordering.installApp')}
      </button>
      {showIosHint && (
        <p
          role="status"
          className="absolute end-0 top-[calc(100%+8px)] z-50 w-64 rounded-2xl border border-[#eadccd] bg-white p-3 text-xs font-semibold leading-5 text-[#5f5245] shadow-[0_16px_40px_rgba(47,35,24,0.16)]"
        >
          {tr('ordering.installIosHint')}
        </p>
      )}
    </div>
  );
}
