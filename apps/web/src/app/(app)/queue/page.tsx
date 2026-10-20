import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronRight, ListOrdered } from 'lucide-react';
import { listOpenOrderQueueVendors } from '@/lib/queries';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardDivider, CardHeader } from '@/components/ui/card';
import { Reveal } from '@/components/motion/reveal';
import { CutoffIndicator } from '@/components/picklist/schedule-indicator';
import { waktu } from '@/components/picklist/status';
import { cn } from '@/components/ui/cn';
import { requirePermission } from '@/lib/session';

export const dynamic = 'force-dynamic';

const PER_PAGE = 30;

export default async function QueuePage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const user = await requirePermission('queue.write');
  if (user.plantId == null) notFound();
  const sp = await searchParams;
  const now = new Date();
  const page = Math.max(1, Math.floor(Number(sp.page ?? 1)) || 1);
  const { data: rows, meta } = await listOpenOrderQueueVendors({
    plantId: user.plantId,
    page,
    perPage: PER_PAGE,
  });

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Operasi' }, { label: 'Antrean Order' }]}
        title="Antrean order"
        description={`${meta.total} supplier · ${meta.items} item OPEN · ≈ ${meta.boxes.toLocaleString('id-ID')} kanban terkumpul`}
      />

      <Reveal>
        <Card>
          <CardHeader
            icon={ListOrdered}
            title="Antrean per supplier"
            subtitle="Pilih supplier untuk melihat item dan memproses Order Sheet setelah cutoff tercapai."
          />
          <CardDivider />

          {rows.length === 0 ? (
            <div className="px-6 py-14 text-center text-[14px] text-ink-muted">
              Belum ada antrean OPEN. Antrean bertambah setelah hasil produksi MES diproses.
            </div>
          ) : (
            <div>
              <div className="hidden grid-cols-[minmax(16rem,1fr)_9rem_10rem_13rem_10rem_2rem] gap-5 border-b border-line px-6 py-3 text-[12px] font-semibold uppercase tracking-wide text-ink-muted lg:grid">
                <span>Supplier</span>
                <span>Item</span>
                <span>Akumulasi</span>
                <span>Cutoff terdekat</span>
                <span>Status</span>
                <span aria-hidden />
              </div>
              <ul className="divide-y divide-line">
                {rows.map((row) => {
                  const due = row.nextCutoffAt.getTime() <= now.getTime();
                  const status = row.blockedCount > 0
                    ? `${row.blockedCount} perlu diperiksa`
                    : due
                      ? 'Siap diproses'
                      : 'Menunggu cutoff';
                  return (
                    <li key={row.vendorId}>
                      <Link
                        href={`/queue/${row.vendorId}`}
                        className="group grid gap-4 px-6 py-5 transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink/20 lg:grid-cols-[minmax(16rem,1fr)_9rem_10rem_13rem_10rem_2rem] lg:items-center lg:gap-5"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-[16px] font-bold text-ink group-hover:underline">
                            {row.vendorName}
                          </p>
                          <p className="mt-1 text-[12px] text-ink-muted">
                            {row.cutoffCount} jadwal cutoff
                            {row.holdCount > 0 ? ` · ${row.holdCount} item ditahan` : ''}
                          </p>
                        </div>
                        <div>
                          <span className="text-[11px] uppercase text-ink-muted lg:hidden">Item · </span>
                          <span className="font-semibold tabular text-ink">{row.itemCount}</span>
                        </div>
                        <div>
                          <p className="font-semibold tabular text-ink">
                            ≈ {row.boxes.toLocaleString('id-ID')} kanban
                          </p>
                          <p className="mt-0.5 text-[11px] tabular text-ink-muted">
                            {row.totalPcs.toLocaleString('id-ID')} pcs
                          </p>
                        </div>
                        <div className="whitespace-nowrap">
                          <p className="font-medium text-ink">{waktu(row.nextCutoffAt)}</p>
                          <CutoffIndicator at={row.nextCutoffAt} now={now} />
                        </div>
                        <span
                          className={cn(
                            'w-fit rounded-full border px-2.5 py-1 text-[11px] font-semibold',
                            row.blockedCount > 0
                              ? 'border-ng/30 bg-ng/10 text-ng'
                              : due
                                ? 'border-ok/30 bg-ok/10 text-ok'
                                : 'border-line text-ink-muted',
                          )}
                        >
                          {status}
                        </span>
                        <ChevronRight
                          className="hidden size-5 text-ink-muted transition-transform group-hover:translate-x-1 lg:block"
                          strokeWidth={1.8}
                          aria-hidden
                        />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </Card>
      </Reveal>

      {meta.totalPages > 1 ? (
        <div className="mt-5 flex items-center gap-4 text-[14px] text-ink-muted">
          <span>
            Halaman {meta.page} dari {meta.totalPages}
          </span>
          {meta.page > 1 ? (
            <Link href={`/queue?page=${meta.page - 1}`} className="font-semibold text-ink hover:underline">
              Sebelumnya
            </Link>
          ) : null}
          {meta.page < meta.totalPages ? (
            <Link href={`/queue?page=${meta.page + 1}`} className="font-semibold text-ink hover:underline">
              Berikutnya
            </Link>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
