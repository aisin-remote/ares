import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ClipboardList, Plus, Send, Download, Truck, CheckCircle2 } from 'lucide-react';
import { PICKLIST_STATUSES, type PicklistStatus } from '@ares/contracts';
import { orderSheetDisplayNo } from '@ares/domain';
import { getPicklistCounts, listPicklists } from '@/lib/queries';
import { requirePermission } from '@/lib/session';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { Card, CardHeader } from '@/components/ui/card';
import { Table, Th, Td, EmptyState } from '@/components/ui/table';
import { ClickableRow } from '@/components/ui/clickable-row';
import { Reveal, Stagger, StaggerItem } from '@/components/motion/reveal';
import { STATUS_LABEL, STATUS_TONE, jam, tanggal } from '@/components/picklist/status';
import { ArrivalIndicator } from '@/components/picklist/schedule-indicator';
import { cn } from '@/components/ui/cn';

export const dynamic = 'force-dynamic';

const PER_PAGE = 25;

/** Daftar picklist (F-17, F-21). */
export default async function PicklistPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Math.floor(Number(sp.page ?? 1)) || 1);
  // Saringan datang dari URL, jadi tidak boleh dipercaya begitu saja.
  const status = sp.status ?? 'ALL';
  const saring = (PICKLIST_STATUSES as readonly string[]).includes(status)
    ? (status as PicklistStatus)
    : undefined;

  /*
   * Akun supplier seharusnya tidak sampai ke halaman ini (layout mengarahkan
   * ke portal), tetapi scope tetap diambil dari sesi. Penjagaan menu gampang
   * terlewat saat halaman baru ditambah; penjagaan di query tidak.
   */
  const sesi = await requirePermission('picklist.read');
  if (sesi.plantId == null) notFound();
  const scope = sesi.vendorId ?? null;

  const [hitungan, { data, meta }] = await Promise.all([
    getPicklistCounts(scope, sesi.plantId),
    listPicklists(scope, { page, perPage: PER_PAGE, plantId: sesi.plantId, status: saring }),
  ]);
  const now = new Date();

  const tautanHalaman = (p: number) =>
    saring ? `/picklist?status=${saring}&page=${p}` : `/picklist?page=${p}`;

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Order Sheet' }]}
        title="Order Sheet"
        description={`${meta.total} order ke supplier, masing-masing dengan kanban satu per box`}
        actions={
          <Link
            href="/picklist/baru"
            className="inline-flex h-11 items-center gap-2 rounded-full bg-accent px-5 text-[14px] font-semibold text-white transition-colors hover:bg-accent-soft"
          >
            <Plus className="size-[18px]" strokeWidth={2.2} aria-hidden />
            Order manual
          </Link>
        }
      />

      <Stagger className="mb-5 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StaggerItem>
          <StatCard
            label="Terbit"
            value={hitungan.terbit}
            hint="belum diunduh supplier"
            icon={Send}
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            label="Diunduh"
            value={hitungan.diunduh}
            hint="kanban sudah dicetak"
            icon={Download}
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            label="Dikirim"
            value={hitungan.jalan}
            hint="di jalan atau diterima sebagian"
            icon={Truck}
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard label="Selesai" value={hitungan.selesai} icon={CheckCircle2} />
        </StaggerItem>
      </Stagger>

      <Reveal>
        <Card>
          <CardHeader
            icon={ClipboardList}
            title="Daftar Order Sheet"
            subtitle={`${meta.total} dokumen`}
            actions={
              <div className="flex flex-wrap gap-1.5">
                {['ALL', ...PICKLIST_STATUSES].map((s) => (
                  <Link
                    key={s}
                    href={s === 'ALL' ? '/picklist' : `/picklist?status=${s}`}
                    className={cn(
                      'rounded-full border px-3 py-1 text-[12px] font-semibold transition-colors',
                      status === s
                        ? 'border-ink bg-surface text-ink'
                        : 'border-line text-ink-muted hover:border-ink hover:text-ink',
                    )}
                  >
                    {s === 'ALL' ? 'Semua' : (STATUS_LABEL[s] ?? s)}
                  </Link>
                ))}
              </div>
            }
          />
          <Table scroll>
            <thead>
              <tr>
                <Th sticky="left">Nomor</Th>
                <Th>Supplier</Th>
                <Th>Tanggal kirim</Th>
                <Th>Jam datang</Th>
                <Th align="right">Line</Th>
                <Th align="right">Box</Th>
                <Th sticky="right">Status</Th>
              </tr>
            </thead>
            <tbody>
              {data.length === 0 ? (
                <EmptyState colSpan={7}>
                  Belum ada Order Sheet pada saringan ini. Mulai dengan{' '}
                  <Link href="/picklist/baru" className="font-semibold text-ink underline">
                    order manual
                  </Link>
                  ; order dari antrean dibuat PPIC setelah waktu cutoff tercapai.
                </EmptyState>
              ) : (
                data.map((p) => (
                  <ClickableRow key={p.id} href={`/picklist/${p.publicId}`}>
                    <Td strong sticky="left" className="tabular whitespace-nowrap">
                      <Link href={`/picklist/${p.publicId}`} className="hover:underline">
                        {orderSheetDisplayNo(p.picklistNo, p.revision)}
                      </Link>
                      {p.type === 'MANUAL' ? (
                        <span className="ml-2 text-[12px] font-normal text-ink-muted">manual</span>
                      ) : null}
                    </Td>
                    <Td>{p.vendorName}</Td>
                    <Td className="tabular whitespace-nowrap">
                      {tanggal(p.deliveryDate)}
                      <ArrivalIndicator
                        deliveryDate={p.deliveryDate}
                        arrivalTime={p.arrivalTime}
                        status={p.status}
                        now={now}
                        className="mt-1 block w-fit"
                      />
                    </Td>
                    <Td className="tabular">{jam(p.arrivalTime)}</Td>
                    <Td align="right" className="tabular">
                      {p.lineCount}
                    </Td>
                    <Td align="right" className="tabular">
                      {p.boxOrdered}
                    </Td>
                    <Td sticky="right">
                      <span
                        className={cn(
                          'inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-1 text-[12px] font-semibold',
                          STATUS_TONE[p.status] ?? 'border-line',
                        )}
                      >
                        {STATUS_LABEL[p.status] ?? p.status}
                      </span>
                    </Td>
                  </ClickableRow>
                ))
              )}
            </tbody>
          </Table>
        </Card>
      </Reveal>

      {meta.totalPages > 1 ? (
        <div className="mt-5 flex items-center gap-4 text-[14px] text-ink-muted">
          <span>
            Halaman {meta.page} dari {meta.totalPages}
          </span>
          {meta.page > 1 ? (
            <Link
              href={tautanHalaman(meta.page - 1)}
              className="font-semibold text-ink hover:underline"
            >
              Sebelumnya
            </Link>
          ) : null}
          {meta.page < meta.totalPages ? (
            <Link
              href={tautanHalaman(meta.page + 1)}
              className="font-semibold text-ink hover:underline"
            >
              Berikutnya
            </Link>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
