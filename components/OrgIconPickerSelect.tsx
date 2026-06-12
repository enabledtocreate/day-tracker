'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Images } from 'lucide-react';
import { DynamicIcon } from 'lucide-react/dynamic';
import type { IconName } from 'lucide-react/dynamic';
import { ORG_LUCIDE_ICON_NAMES, isOrgLucideIconName, normalizeStoredOrgIcon } from '@/lib/orgLucideIconNames';
import { OrgLucideIcon } from '@/components/OrgLucideIcon';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

type Props = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
};

const ROW_PX = 52;

function VirtualizedIconGrid({
  names,
  selectedNorm,
  onPick,
}: {
  names: readonly string[];
  selectedNorm: string;
  onPick: (n: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [clientH, setClientH] = useState(360);
  const [cols, setCols] = useState(6);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 640px)');
    const apply = () => setCols(mq.matches ? 8 : 6);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setClientH(el.clientHeight));
    ro.observe(el);
    setClientH(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = 0;
    setScrollTop(0);
  }, [names]);

  const rows = Math.max(1, Math.ceil(names.length / cols));
  const startRow = Math.max(0, Math.floor(scrollTop / ROW_PX) - 2);
  const endRow = Math.min(rows - 1, Math.ceil((scrollTop + clientH) / ROW_PX) + 2);

  const rowEls: ReactNode[] = [];
  for (let r = startRow; r <= endRow; r++) {
    const slice = names.slice(r * cols, r * cols + cols);
    rowEls.push(
      <div
        key={r}
        className={cn('grid gap-1.5 sm:gap-2', cols === 8 ? 'grid-cols-8' : 'grid-cols-6')}
        style={{ minHeight: ROW_PX }}
      >
        {slice.map((n) => (
          <button
            key={n}
            type="button"
            title={n}
            className={cn(
              'flex size-11 shrink-0 items-center justify-center rounded-lg border border-transparent transition-colors',
              'hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              selectedNorm === n && 'border-primary/50 bg-muted',
            )}
            onClick={() => onPick(n)}
          >
            <DynamicIcon name={n as IconName} width={26} height={26} strokeWidth={2} aria-hidden className="shrink-0" />
          </button>
        ))}
      </div>,
    );
  }

  return (
    <div
      ref={scrollRef}
      className="max-h-[min(52vh,420px)] overflow-y-auto overscroll-contain pr-1"
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      {startRow > 0 ? <div aria-hidden style={{ height: startRow * ROW_PX }} /> : null}
      {rowEls}
      {endRow < rows - 1 ? <div aria-hidden style={{ height: (rows - 1 - endRow) * ROW_PX }} /> : null}
    </div>
  );
}

/** Lucide icon picker: button shows current icon; opens a searchable virtualized grid. */
export function OrgIconPickerSelect({ id, value, onChange, className }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return ORG_LUCIDE_ICON_NAMES;
    return ORG_LUCIDE_ICON_NAMES.filter((n) => n.includes(q));
  }, [search]);

  const pick = (name: string) => {
    onChange(name);
    setOpen(false);
    setSearch('');
  };

  const selectedNorm = normalizeStoredOrgIcon(value) ?? '';
  const hasValidIcon = Boolean(value && isOrgLucideIconName(value));
  const ariaLabel = hasValidIcon ? `Icon: ${selectedNorm || value}. Change icon` : 'Choose icon';

  useEffect(() => {
    if (!open) setSearch('');
  }, [open]);

  return (
    <>
      <Button
        id={id}
        type="button"
        variant="outline"
        size="icon-sm"
        className={cn('shrink-0 border-dashed', className)}
        onClick={() => setOpen(true)}
        aria-label={ariaLabel}
        title={hasValidIcon ? selectedNorm || value : 'No icon — click to choose'}
      >
        {hasValidIcon ? (
          <OrgLucideIcon name={value} size={20} aria-hidden />
        ) : value ? (
          <span className="text-[0.65rem] font-medium leading-none text-muted-foreground" title="Unknown icon">
            ?
          </span>
        ) : (
          <Images className="size-4 text-muted-foreground" aria-hidden strokeWidth={2} />
        )}
      </Button>

      <Dialog open={open} onOpenChange={setOpen} modal>
        <DialogContent className="max-h-[min(90vh,720px)] w-[min(95vw,520px)] max-w-[min(95vw,520px)] gap-3 p-4 sm:max-w-xl">
          <DialogHeader className="gap-1">
            <DialogTitle>Choose icon</DialogTitle>
          </DialogHeader>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search icons…"
            className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Search icons"
          />
          <Button
            type="button"
            variant="outline"
            className="h-9 w-full justify-center font-normal text-muted-foreground"
            onClick={() => pick('')}
          >
            No icon
          </Button>
          {filtered.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No icons match that search.</p>
          ) : (
            <VirtualizedIconGrid names={filtered} selectedNorm={selectedNorm} onPick={pick} />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
