'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { BranchOption } from './branch-provider';

export function BranchPicker({
  branches,
  value,
  onChange,
}: {
  branches: BranchOption[];
  value: string;
  onChange: (branchId: string) => void;
}) {
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
    <div ref={rootRef} className="relative hidden items-center gap-2 sm:flex">
      <span className="text-xs font-bold text-ink-muted">Branch</span>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={expanded}
        onClick={() => setExpanded((c) => !c)}
        className="flex min-h-11 min-w-44 items-center justify-between gap-4 rounded-xl border border-line bg-white px-4 text-left text-xs font-black shadow-sm transition hover:border-brand/40 hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/25"
      >
        <span className="truncate">{selected?.name ?? 'Select branch'}</span>
        <ChevronDown size={16} aria-hidden="true" className={cn('shrink-0 text-ink-muted transition-transform', expanded && 'rotate-180')} />
      </button>
      {expanded && (
        <div
          ref={listRef}
          role="listbox"
          aria-activedescendant={activeIndex >= 0 ? `branch-option-${activeIndex}` : undefined}
          aria-label="Active branch"
          onKeyDown={handleKeyDown}
          className="absolute left-[52px] top-[calc(100%+8px)] z-50 w-72 overflow-hidden rounded-2xl border border-black/10 bg-white p-2 shadow-[0_18px_55px_rgba(25,31,28,.18)]"
        >
          {needsSearch && (
            <div className="relative px-2 pb-2">
              <Search size={14} aria-hidden="true" className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-muted" />
              <input
                ref={searchRef}
                type="text"
                placeholder="Search branches…"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setActiveIndex(0); }}
                className="w-full rounded-lg border border-line bg-surface-subtle py-2 pl-8 pr-3 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-brand/25"
                aria-label="Search branches"
              />
            </div>
          )}
          {!needsSearch && (
            <p className="px-3 pb-2 pt-1 text-[9px] font-black uppercase tracking-[.16em] text-ink-muted">Switch workspace</p>
          )}
          {filtered.length === 0 && (
            <p className="px-3 py-4 text-center text-sm text-ink-muted">No branches found</p>
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
                  'flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-sm transition',
                  active ? 'bg-[#18241f] text-white' : highlighted ? 'bg-surface-subtle' : 'text-[#18241f] hover:bg-surface-subtle',
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
