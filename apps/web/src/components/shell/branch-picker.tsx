'use client';

import { useEffect, useRef, useState } from 'react';
import { Building2, Check, ChevronDown, Search } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useLocale } from '@/components/locale-provider';
import type { BranchOption } from './branch-provider';

export function BranchPicker({
  branches,
  value,
  onChange,
  workspaceName,
}: {
  branches: BranchOption[];
  value: string;
  onChange: (branchId: string) => void;
  workspaceName?: string;
}) {
  const { tr } = useLocale();
  const [expanded, setExpanded] = useState(false);
  const [search, setSearch] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const selected = branches.find((b) => b.id === value);
  const needsSearch = branches.length > 7;

  const filtered = needsSearch
    ? branches.filter((b) => b.name.toLowerCase().includes(search.toLowerCase()))
    : branches;

  useEffect(() => {
    if (!expanded) return;
    function closeOnOutsideClick(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setExpanded(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setExpanded(false);
    }
    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [expanded]);

  useEffect(() => {
    if (expanded && needsSearch) searchRef.current?.focus();
    if (expanded && !needsSearch) {
      const idx = filtered.findIndex((b) => b.id === value);
      setActiveIndex(idx >= 0 ? idx : 0);
    }
  }, [expanded, needsSearch, filtered, value]);

  useEffect(() => {
    if (activeIndex < 0 || !listRef.current) return;
    const options = listRef.current.querySelectorAll('[role="option"]');
    const el = options[activeIndex];
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex]);

  function handleKeyDown(event: React.KeyboardEvent) {
    if (!expanded) return;
    const count = filtered.length;
    if (count === 0) return;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActiveIndex((i) => (i + 1) % count);
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActiveIndex((i) => (i - 1 + count) % count);
        break;
      case 'Home':
        event.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        event.preventDefault();
        setActiveIndex(count - 1);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (activeIndex >= 0 && activeIndex < count) {
          setExpanded(false);
          setSearch('');
          onChange(filtered[activeIndex].id);
        }
        break;
    }
  }

  return (
    <div ref={rootRef} className="relative hidden items-center sm:flex">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={expanded}
        onClick={() => setExpanded((c) => !c)}
        className="flex min-h-12 min-w-64 items-center gap-3 rounded-control border border-border bg-surface px-3 text-start shadow-sm transition duration-normal hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand/10 text-brand"><Building2 size={16} aria-hidden="true" /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[11px] font-semibold text-ink-muted">{workspaceName ?? tr('navigation.restaurantWorkspace')}</span>
          <span className="block truncate text-sm font-semibold text-ink">{selected?.name ?? tr('navigation.selectBranch')}</span>
        </span>
        <ChevronDown size={16} aria-hidden="true" className={cn('shrink-0 text-ink-muted transition-transform', expanded && 'rotate-180')} />
      </button>
      {expanded && (
        <div
          ref={listRef}
          role="listbox"
          aria-activedescendant={activeIndex >= 0 ? `branch-option-${activeIndex}` : undefined}
          aria-label={tr('navigation.activeBranch')}
          onKeyDown={handleKeyDown}
          className="absolute start-0 top-[calc(100%+8px)] z-50 w-80 overflow-hidden rounded-panel border border-border bg-surface/95 p-2 shadow-float backdrop-blur-xl"
        >
          {needsSearch && (
            <div className="relative px-2 pb-2">
              <Search size={14} aria-hidden="true" className="absolute start-4 top-1/2 -translate-y-1/2 text-ink-muted" />
              <input
                ref={searchRef}
                type="text"
                placeholder={tr('navigation.searchBranches')}
                value={search}
                onChange={(e) => { setSearch(e.target.value); setActiveIndex(0); }}
                className="w-full rounded-lg border border-line bg-surface-subtle py-2 ps-8 pe-3 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-brand/25"
                aria-label={tr('navigation.searchBranchesLabel')}
              />
            </div>
          )}
          {!needsSearch && (
            <div className="px-3 pb-2 pt-1"><p className="text-[10px] font-semibold uppercase tracking-[.12em] text-ink-muted">{workspaceName ?? tr('navigation.restaurantWorkspace')}</p><p className="mt-1 text-xs text-ink-muted">{tr('navigation.switchBranch')}</p></div>
          )}
          {filtered.length === 0 && (
            <p className="px-3 py-4 text-center text-sm text-ink-muted">{tr('navigation.noBranchesFound')}</p>
          )}
          {filtered.map((branch, index) => {
            const active = branch.id === value;
            const highlighted = index === activeIndex;
            return (
              <button
                key={branch.id}
                id={`branch-option-${index}`}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  setExpanded(false);
                  setSearch('');
                  onChange(branch.id);
                }}
                onMouseEnter={() => setActiveIndex(index)}
                className={cn(
                  'flex min-h-12 w-full items-center gap-3 rounded-control px-3 text-start text-sm transition',
                  active ? 'bg-brand text-white' : highlighted ? 'bg-surface-subtle' : 'text-ink hover:bg-surface-subtle',
                )}
              >
                <span className={cn(
                  'grid size-8 shrink-0 place-items-center rounded-lg text-[10px] font-black',
                  active ? 'bg-white/12 text-white' : 'bg-brand/10 text-brand',
                )}>
                  {branch.name.slice(0, 2).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-black">{branch.name}</span>
                  <span className={cn('block truncate text-[10px]', active ? 'text-white/55' : 'text-ink-muted')}>
                    {branch.slug}
                  </span>
                </span>
                {active && <Check size={16} aria-hidden="true" className="text-emerald-300" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
