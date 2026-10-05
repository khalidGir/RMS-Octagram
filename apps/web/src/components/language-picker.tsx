'use client';

import { Languages } from 'lucide-react';
import { cn } from '@/lib/cn';
import { localeCodes, localeNames, useLocale, type LocaleCode } from './locale-provider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

export function LanguagePicker({ compact = false, className }: { compact?: boolean; className?: string }) {
  const { locale, setLocale, tr } = useLocale();
  return (
    <div className={cn(compact ? 'w-[9.5rem]' : 'w-full max-w-52', className)}>
      <Select value={locale} onValueChange={(value) => setLocale(value as LocaleCode)}>
        <SelectTrigger aria-label={tr('common.language')} className={compact ? 'bg-transparent shadow-none' : undefined}>
          <Languages className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="end">
          {localeCodes.map((code) => <SelectItem key={code} value={code}><span lang={code} dir={code === 'ar' ? 'rtl' : 'ltr'}>{localeNames[code]}</span></SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}
