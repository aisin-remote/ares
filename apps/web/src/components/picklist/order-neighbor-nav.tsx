import Link from 'next/link';
import { ArrowLeft, ArrowRight, List } from 'lucide-react';
import { cn } from '../ui/cn';

interface Neighbor {
  publicId: string;
  label: string;
}

export function OrderNeighborNav({
  previous,
  next,
  basePath,
}: {
  previous: Neighbor | null;
  next: Neighbor | null;
  basePath: '/picklist' | '/portal';
}) {
  return (
    <nav
      aria-label="Navigasi antar Order Sheet"
      className="mb-5 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-stretch gap-2"
    >
      <NeighborLink direction="previous" neighbor={previous} basePath={basePath} />
      <Link
        href={basePath}
        className="grid min-h-14 place-items-center rounded-2xl border border-line bg-card px-3 text-ink-muted transition-colors hover:border-ink hover:text-ink"
        aria-label="Kembali ke daftar Order Sheet"
      >
        <List className="size-4" strokeWidth={2} aria-hidden />
      </Link>
      <NeighborLink direction="next" neighbor={next} basePath={basePath} />
    </nav>
  );
}

function NeighborLink({
  direction,
  neighbor,
  basePath,
}: {
  direction: 'previous' | 'next';
  neighbor: Neighbor | null;
  basePath: string;
}) {
  const previous = direction === 'previous';
  const content = (
    <>
      {previous ? <ArrowLeft className="size-4 shrink-0" aria-hidden /> : null}
      <span className={cn('min-w-0', !previous && 'text-right')}>
        <span className="block text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
          Order {previous ? 'sebelumnya' : 'berikutnya'}
        </span>
        <span className="mt-0.5 block truncate font-mono text-[12px] font-bold">
          {neighbor?.label ?? 'Tidak ada'}
        </span>
      </span>
      {!previous ? <ArrowRight className="size-4 shrink-0" aria-hidden /> : null}
    </>
  );

  if (!neighbor) {
    return (
      <span
        className={cn(
          'flex min-w-0 items-center gap-2 rounded-2xl border border-line/60 bg-surface/40 px-3 text-ink-muted opacity-55',
          !previous && 'justify-end',
        )}
      >
        {content}
      </span>
    );
  }

  return (
    <Link
      href={`${basePath}/${neighbor.publicId}`}
      className={cn(
        'flex min-w-0 items-center gap-2 rounded-2xl border border-line bg-card px-3 transition-colors hover:border-ink hover:bg-surface',
        !previous && 'justify-end',
      )}
    >
      {content}
    </Link>
  );
}
