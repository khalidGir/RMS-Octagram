import { notFound } from 'next/navigation';
import { Button, Card, PageHeader, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, StatusChip, TextField } from '@/components/ui';
import { BrandMark } from '@/components/brand-mark';
import { TenantThemeScope } from '@/components/theme-provider';

export default function DesignSystemPage() {
  if (process.env.NODE_ENV === 'production') notFound();

  return (
    <div className="page-shell space-y-12 p-6 sm:p-10">
      <PageHeader eyebrow="RestaurantMS" title="Product design system" description="Platform-owned foundations for staff operations, with tenant branding isolated to customer surfaces." />

      <section className="space-y-4">
        <h2 className="text-xl font-bold text-ink">Colors</h2>
        <div className="grid grid-cols-5 gap-3">
          <div className="space-y-1"><div className="h-16 rounded-card bg-brand" /><p className="text-xs font-bold text-ink-muted">brand</p></div>
          <div className="space-y-1"><div className="h-16 rounded-card bg-brand-accent" /><p className="text-xs font-bold text-ink-muted">accent</p></div>
          <div className="space-y-1"><div className="h-16 rounded-card bg-success" /><p className="text-xs font-bold text-ink-muted">success</p></div>
          <div className="space-y-1"><div className="h-16 rounded-card bg-warning" /><p className="text-xs font-bold text-ink-muted">warning</p></div>
          <div className="space-y-1"><div className="h-16 rounded-card bg-danger" /><p className="text-xs font-bold text-ink-muted">danger</p></div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-bold text-ink">Typography</h2>
        <p className="text-5xl font-semibold tracking-[-.05em] text-ink">Display title</p>
        <p className="text-lg font-semibold text-ink">Section heading</p>
        <p className="text-sm text-ink">Body</p>
        <p className="text-xs text-ink-muted">Caption</p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-ink">Controls</h2>
        <Card className="grid gap-5 p-6 sm:grid-cols-2">
          <TextField label="Phone number" type="tel" placeholder="0911 234 567" />
          <div><p className="mb-2 text-xs font-semibold">Branch</p><Select defaultValue="bole"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="bole">Bole Main</SelectItem><SelectItem value="downtown">Downtown</SelectItem></SelectContent></Select></div>
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2"><Button>Primary action</Button><Button variant="secondary">Secondary</Button><Button variant="ghost">Quiet action</Button><Button variant="danger">Destructive</Button></div>
        </Card>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-bold text-ink">Status Chips</h2>
        <div className="flex flex-wrap gap-2">
          <StatusChip status="success">Active</StatusChip>
          <StatusChip status="warning">Pending</StatusChip>
          <StatusChip status="danger">Error</StatusChip>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-ink">Brand isolation</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Card className="p-6"><BrandMark onDark={false} /><p className="mt-5 text-sm text-ink-muted">Authenticated staff surfaces always retain the RestaurantMS product identity.</p></Card>
          <TenantThemeScope theme={{ primaryColor: '#B4532A', accentColor: '#C08A2E', storefrontMode: 'light', radius: 'rounded', fontFamily: 'inter' }}><Card className="p-6"><BrandMark onDark={false} name="Buna House" subtitle="Customer ordering" /><Button className="mt-5">Tenant-styled action</Button></Card></TenantThemeScope>
        </div>
      </section>
    </div>
  );
}
