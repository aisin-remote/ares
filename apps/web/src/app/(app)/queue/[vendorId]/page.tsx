import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, CalendarClock } from 'lucide-react';
import { pcsToBoxes } from '@ares/domain';
import { getOpenOrderQueueVendorDetail } from '@/lib/queries';
import { requirePermission } from '@/lib/session';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState, Table, Td, Th, Tr } from '@/components/ui/table';
import { Reveal } from '@/components/motion/reveal';
import { CutoffIndicator } from '@/components/picklist/schedule-indicator';
import { waktu } from '@/components/picklist/status';

export const dynamic = 'force-dynamic';

export default async function QueueVendorDetailPage({
  params,
}: {
  params: Promise<{ vendorId: string }>;
}) {
  const user = await requirePermission('queue.write');
  if (user.plantId == null) notFound();
  const vendorId = Number((await params).vendorId);
  if (!Number.isInteger(vendorId) || vendorId <= 0) notFound();

  const detail = await getOpenOrderQueueVendorDetail(vendorId, user.plantId);
  if (!detail) notFound();

  const now = new Date();
  const cutoffClock = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const plannedRows = detail.rows.map((row) => {
    const cutoffTime = `${cutoffClock.format(row.cutoffAt)}:00`;
    const rounding = detail.cutoffs.find((item) => item.cutoffTime === cutoffTime)?.rounding ?? 'FLOOR';
    const plan = pcsToBoxes(row.pcs + row.carryOverPcs, row.qtyPerBox, rounding);
    return {
      ...row,
      plannedKanban: plan.boxes,
      remainingKanban: plan.carryOverPcs / row.qtyPerBox,
    };
  });
  const groups = new Map<string, { cutoffAt: Date; rows: typeof plannedRows }>();
  for (const row of plannedRows) {
    const key = row.cutoffAt.toISOString();
    const group = groups.get(key) ?? { cutoffAt: row.cutoffAt, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }
  const totalKanban = plannedRows.reduce((sum, row) => sum + row.plannedKanban, 0);

  return (
    <>
      <PageHeader
        crumbs={[
          { label: 'Antrean Order', href: '/queue' },
          { label: detail.name },
        ]}
        title={detail.name}
        description={`${detail.rows.length} item OPEN · ${totalKanban.toLocaleString('id-ID')} kanban direncanakan${detail.sapVendorNo ? ` · vendor ${detail.sapVendorNo}` : ''}`}
      />

      {groups.size === 0 ? (
        <Reveal>
          <Card>
            <Table>
              <tbody>
                <EmptyState colSpan={1}>
                  Tidak ada antrean OPEN untuk supplier ini. Order yang selesai diproses dapat dilihat di menu Order Sheet.
                </EmptyState>
              </tbody>
            </Table>
          </Card>
        </Reveal>
      ) : (
        <div className="space-y-5">
          {[...groups.values()].map((group) => {
            const kanban = group.rows.reduce((sum, row) => sum + row.plannedKanban, 0);
            const due = group.cutoffAt.getTime() <= now.getTime();
            const orderHref = `/queue/${vendorId}/order?cutoff=${encodeURIComponent(group.cutoffAt.toISOString())}`;
            return (
              <Reveal key={group.cutoffAt.toISOString()}>
                <Card>
                  <CardHeader
                    icon={CalendarClock}
                    title={`Cutoff ${waktu(group.cutoffAt)}`}
                    subtitle={
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span>{group.rows.length} item · {kanban.toLocaleString('id-ID')} kanban</span>
                        <CutoffIndicator at={group.cutoffAt} now={now} />
                      </div>
                    }
                  />
                  <Table>
                    <thead>
                      <tr>
                        <Th>Part</Th>
                        <Th>Back no</Th>
                        <Th align="right">Qty order</Th>
                        <Th align="right">Standar</Th>
                        <Th>Perbandingan</Th>
                        <Th align="right">Sisa</Th>
                        <Th>Status</Th>
                        <Th>Aksi</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.rows.map((row) => (
                        <Tr key={row.id}>
                          <Td strong>
                            {row.partNo}
                            <span className="ml-2 font-normal text-ink-muted">{row.partName}</span>
                          </Td>
                          <Td>{row.backNo}</Td>
                          <Td align="right" className="tabular">
                            <span className="font-bold text-ink">{row.plannedKanban} kanban</span>
                            <span className="mt-0.5 block text-[11px] text-ink-muted">
                              {row.qtyPerBox} pcs/kanban
                            </span>
                          </Td>
                          <Td align="right" className="tabular">
                            {row.standardKanban == null ? '—' : `${row.standardKanban} kanban`}
                          </Td>
                          <Td>
                            {row.standardKanban == null ? (
                              <Link
                                href="/master/orderStandards"
                                className="text-[12px] font-semibold text-warn hover:underline"
                              >
                                Standar belum diatur
                              </Link>
                            ) : row.plannedKanban === row.standardKanban ? (
                              <span className="rounded-full border border-ok/30 bg-ok/10 px-2.5 py-1 text-[11px] font-semibold text-ok">
                                Sesuai standar
                              </span>
                            ) : (
                              <span className="rounded-full border border-warn/30 bg-warn/10 px-2.5 py-1 text-[11px] font-semibold text-warn">
                                {row.plannedKanban > row.standardKanban ? '+' : ''}
                                {row.plannedKanban - row.standardKanban} kanban
                              </span>
                            )}
                          </Td>
                          <Td align="right" className="tabular">
                            {row.remainingKanban.toLocaleString('id-ID', { maximumFractionDigits: 2 })} kanban
                          </Td>
                          <Td>
                            {row.hold ? (
                              <span className="font-semibold text-warn">Ditahan</span>
                            ) : row.blockedReason ? (
                              <div className="max-w-72">
                                <span className="font-semibold text-ng">Perlu diperiksa</span>
                                <p className="mt-1 text-[12px] leading-4 text-ink-muted">
                                  {row.blockedReason}
                                </p>
                              </div>
                            ) : (
                              <span className="font-semibold text-ok">
                                {due ? 'Siap diproses' : 'Menunggu cutoff'}
                              </span>
                            )}
                          </Td>
                          <Td>
                            <Link
                              href={orderHref}
                              className="inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-full bg-accent px-4 text-[13px] font-semibold text-white transition-colors hover:bg-accent-soft"
                            >
                              {due ? 'Buat Order Sheet' : 'Siapkan order'}
                              <ArrowRight className="size-4" aria-hidden />
                            </Link>
                          </Td>
                        </Tr>
                      ))}
                    </tbody>
                  </Table>
                </Card>
              </Reveal>
            );
          })}
        </div>
      )}
    </>
  );
}
