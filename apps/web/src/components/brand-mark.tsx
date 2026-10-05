export function BrandMark({ compact = false, onDark = true, name = 'RestaurantMS', subtitle = 'Hospitality OS' }: { compact?: boolean; onDark?: boolean; name?: string; subtitle?: string }) {
  return (
    <div className="flex items-center gap-3" aria-label={name}>
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand text-sm font-black text-white shadow-lg shadow-brand/20">{name.charAt(0)}</span>
      {!compact && <span className="leading-none"><span className="block text-[15px] font-bold tracking-[-0.025em]">{name}</span><span className={`mt-1 block text-[10px] font-semibold uppercase tracking-[0.14em] ${onDark ? 'text-white/45' : 'text-ink-muted'}`}>{subtitle}</span></span>}
    </div>
  );
}
