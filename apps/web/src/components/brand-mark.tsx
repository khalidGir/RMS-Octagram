export function BrandMark({ compact = false, onDark = true }: { compact?: boolean; onDark?: boolean }) {
  return (
    <div className="flex items-center gap-3" aria-label="Buna House">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand text-sm font-black text-white shadow-lg shadow-brand/20">B</span>
      {!compact && <span className="leading-none"><span className="block text-[15px] font-extrabold tracking-[-0.02em]">Buna House</span><span className={`mt-1 block text-[10px] font-semibold uppercase tracking-[0.18em] ${onDark ? 'text-white/45' : 'text-ink-muted'}`}>Restaurant OS</span></span>}
    </div>
  );
}
