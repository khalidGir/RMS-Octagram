'use client';

import { notFound } from 'next/navigation';
import { Button, Card, PageHeader, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, StatusChip, TextField } from '@/components/ui';
import { BrandMark } from '@/components/brand-mark';
import { TenantThemeScope } from '@/components/theme-provider';
import { useLocale } from '@/components/locale-provider';

export default function DesignSystemPage() {
  const { tr } = useLocale();
  if (process.env.NODE_ENV === 'production') notFound();

  return (
    <div className="page-shell space-y-12 p-6 sm:p-10">
      <PageHeader eyebrow="RestaurantMS" title={tr('showcase.dsTitle')} description={tr('showcase.dsDesc')} />

      <section className="space-y-4">
        <h2 className="text-xl font-bold text-ink">{tr('showcase.colorsH')}</h2>
        <div className="grid grid-cols-5 gap-3">
          <div className="space-y-1"><div className="h-16 rounded-card bg-brand" /><p className="text-xs font-bold text-ink-muted">brand</p></div>
          <div className="space-y-1"><div className="h-16 rounded-card bg-brand-accent" /><p className="text-xs font-bold text-ink-muted">accent</p></div>
          <div className="space-y-1"><div className="h-16 rounded-card bg-success" /><p className="text-xs font-bold text-ink-muted">success</p></div>
          <div className="space-y-1"><div className="h-16 rounded-card bg-warning" /><p className="text-xs font-bold text-ink-muted">warning</p></div>
          <div className="space-y-1"><div className="h-16 rounded-card bg-danger" /><p className="text-xs font-bold text-ink-muted">danger</p></div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-bold text-ink">{tr('showcase.typographyH')}</h2>
        <p className="text-5xl font-semibold tracking-[-.05em] text-ink">{tr('showcase.typoDisplay')}</p>
        <p className="text-lg font-semibold text-ink">{tr('showcase.typoSection')}</p>
        <p className="text-sm text-ink">{tr('showcase.typoBody')}</p>
        <p className="text-xs text-ink-muted">{tr('showcase.typoCaption')}</p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-ink">{tr('showcase.controlsH')}</h2>
        <Card className="grid gap-5 p-6 sm:grid-cols-2">
          <TextField label={tr('showcase.phoneLabel')} type="tel" placeholder="0911 234 567" />
          <div><p className="mb-2 text-xs font-semibold">{tr('showcase.branchLabel')}</p><Select defaultValue="bole"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="bole">Bole Main</SelectItem><SelectItem value="downtown">Downtown</SelectItem></SelectContent></Select></div>
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2"><Button>{tr('showcase.btnPrimary')}</Button><Button variant="secondary">{tr('showcase.btnSecondary')}</Button><Button variant="ghost">{tr('showcase.btnQuiet')}</Button><Button variant="danger">{tr('showcase.btnDestructive')}</Button></div>
        </Card>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-bold text-ink">{tr('showcase.chipsH')}</h2>
        <div className="flex flex-wrap gap-2">
          <StatusChip status="success">{tr('showcase.chipActive')}</StatusChip>
          <StatusChip status="warning">{tr('showcase.chipPending')}</StatusChip>
          <StatusChip status="danger">{tr('showcase.chipError')}</StatusChip>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-ink">{tr('showcase.brandIsoH')}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Card className="p-6"><BrandMark onDark={false} /><p className="mt-5 text-sm text-ink-muted">{tr('showcase.brandIsoNote')}</p></Card>
          <TenantThemeScope theme={{ primaryColor: '#B4532A', accentColor: '#C08A2E', storefrontMode: 'light', radius: 'rounded', fontFamily: 'inter' }}><Card className="p-6"><BrandMark onDark={false} name="Buna House" subtitle={tr('showcase.brandMarkSub')} /><Button className="mt-5">{tr('showcase.tenantBtn')}</Button></Card></TenantThemeScope>
        </div>
      </section>
    </div>
  );
}
