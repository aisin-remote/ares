import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  AlertTriangle,
  Boxes,
  CalendarDays,
  ClipboardList,
  Clock3,
  Download,
  Send,
  Truck,
} from 'lucide-react';
import { orderSheetDisplayNo } from '@ares/domain';
import { getPicklistCounts, listPicklists } from '@/lib/queries';
import { getSessionUser } from '@/lib/session';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { Card, CardHeader } from '@/components/ui/card';
import { Table, Th, Td, EmptyState } from '@/components/ui/table';
import { ClickableRow } from '@/components/ui/clickable-row';
import { Reveal, Stagger, StaggerItem } from '@/components/motion/reveal';
import { UnduhDokumen } from '@/components/portal/unduh-dokumen';
import { STATUS_LABEL, STATUS_TONE, jam, tanggal } from '@/components/picklist/status';
import { ArrivalIndicator } from '@/components/picklist/schedule-indicator';
import { cn } from '@/components/ui/cn';

export const dynamic = 'force-dynamic';

const PER_PAGE = 25;

/** Order yang masih berjalan — yang sudah selesai pindah ke halaman riwayat. */
const AKTIF = ['ISSUED', 'DOWNLOADED', 'SHIPPED', 'PARTIAL'] as const;

/** Dashboard portal supplier (F-28). */
export default async function PortalPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string }>;
}) {
  const sesi = await getSessionUser();
  if (sesi?.vendorId == null || sesi.plantId == null) redirect('/login');
  const scope = sesi.vendorId;

  const sp = await searchParams;
  const page = Math.max(1, Math.floor(Number(sp.page ?? 1)) || 1);
  const status = AKTIF.includes(sp.status as (typeof AKTIF)[number])
    ? (sp.status as (typeof AKTIF)[number])
    : undefined;

  const [hitungan, { data, meta }] = await Promise.all([
    getPicklistCounts(scope, sesi.plantId),
    listPicklists(scope, {
      page,
      perPage: PER_PAGE,
      plantId: sesi.plantId,
      statuses: status ? [status] : [...AKTIF],
    }),
  ]);
  const tautanHalaman = (nomor: number) =>
    status ? `/portal?status=${status}&page=${nomor}` : `/portal?page=${nomor}`;
  const now = new Date();

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Order berjalan' }]}
        title="Order dari Aisin"
        description={`${meta.total} order berjalan — unduh, cetak kanbannya, lalu kirim sesuai jam kedatangan`}
      />

      <Stagger className="mb-5 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StaggerItem>
          <StatCard
            label="Order baru"
            value={hitungan.terbit}
            hint="belum Anda unduh"
            icon={Send}
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            label="Sudah diunduh"
            value={hitungan.diunduh}
            hint="kanban siap dicetak"
            icon={Download}
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard label="Dikirim" value={hitungan.jalan} hint="menunggu diterima" icon={Truck} />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            label="Lewat tanggal kirim"
            value={hitungan.terlambat}
            hint="belum dikonfirmasi kirim"
            icon={AlertTriangle}
          />
        </StaggerItem>
      </Stagger>

      {hitungan.terlambat > 0 ? (
        <p className="mb-5 flex items-start gap-2 rounded-card border border-warn/40 bg-warn/10 px-4 py-3 text-[14px] text-warn">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden />
          <span>
            Ada {hitungan.terlambat} order yang tanggal kirimnya sudah lewat dan belum dikonfirmasi.
            Hubungi PPIC bila barang memang tidak bisa dikirim — pabrik menunggu komponen ini di
            line.
          </span>
        </p>
      ) : null}

      <Reveal>
        <Card>
          <CardHeader
            icon={ClipboardList}
            title="Order berjalan"
            subtitle={`${meta.total} dokumen — unduh, cetak kanbannya, lalu konfirmasi kirim`}
            actions={
              <div className="hidden flex-wrap gap-1.5 md:flex">
                {[undefined, ...AKTIF].map((item) => (
                  <Link
                    key={item ?? 'ALL'}
                    href={item ? `/portal?status=${item}` : '/portal'}
                    className={cn(
                      'rounded-full border px-3 py-1 text-[12px] font-semibold transition-colors',
                      status === item
                        ? 'border-ink bg-surface text-ink'
                        : 'border-line text-ink-muted hover:border-ink hover:text-ink',
                    )}
                  >
                    {item ? (STATUS_LABEL[item] ?? item) : 'Semua'}
                  </Link>
                ))}
              </div>
            }
          />

          <div className="scroll-slim flex gap-2 overflow-x-auto border-t border-line px-4 py-3 md:hidden">
            {[undefined, ...AKTIF].map((item) => (
              <Link
                key={item ?? 'ALL-MOBILE'}
                href={item ? `/portal?status=${item}` : '/portal'}
                className={cn(
                  'shrink-0 rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-colors',
                  status === item ? 'border-ink bg-surface text-ink' : 'border-line text-ink-muted',
                )}
              >
                {item ? (STATUS_LABEL[item] ?? item) : 'Semua'}
              </Link>
            ))}
          </div>

          {data.length === 0 ? (
            <div className="border-t border-line px-5 py-10 text-center text-[14px] leading-6 text-ink-muted md:hidden">
              Belum ada order berjalan. Order baru muncul setelah diterbitkan PPIC dan Anda akan
              menerima email pemberitahuan.
            </div>
          ) : (
            <div className="divide-y divide-line border-t border-line md:hidden">
              {data.map((p) => {
                const nomor = orderSheetDisplayNo(p.picklistNo, p.revision);
                const perluKonfirmasi = p.status === 'ISSUED' || p.status === 'DOWNLOADED';
                return (
                  <article key={p.id} className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link
                          href={`/portal/${p.publicId}`}
                          className="block truncate font-mono text-[16px] font-bold text-ink"
                        >
                          {nomor}
                        </Link>
                        {p.downloadedAt === null ? (
                          <span className="mt-1.5 inline-flex rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent">
                            Order baru
                          </span>
                        ) : null}
                      </div>
                      <span
                        className={cn(
                          'inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-semibold',
                          STATUS_TONE[p.status] ?? 'border-line',
                        )}
                      >
                        {STATUS_LABEL[p.status] ?? p.status}
                      </span>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 rounded-2xl bg-surface px-3.5 py-3 text-[12px]">
                      <MobileInfo
                        icon={CalendarDays}
                        label="Tanggal kirim"
                        value={tanggal(p.deliveryDate)}
                      />
                      <MobileInfo icon={Clock3} label="Jam datang" value={jam(p.arrivalTime)} />
                      <MobileInfo
                        icon={ClipboardList}
                        label="Cycle / part"
                        value={`${p.cycle} / ${p.lineCount}`}
                      />
                      <MobileInfo icon={Boxes} label="Jumlah box" value={String(p.boxOrdered)} />
                    </div>

                    <ArrivalIndicator
                      deliveryDate={p.deliveryDate}
                      arrivalTime={p.arrivalTime}
                      status={p.status}
                      now={now}
                      className="mt-3"
                    />

                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <Link
                        href={`/portal/${p.publicId}`}
                        className={cn(
                          'inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-full px-4 text-[13px] font-semibold',
                          perluKonfirmasi
                            ? 'bg-accent text-white hover:bg-accent-soft'
                            : 'border border-line bg-card text-ink hover:border-ink',
                        )}
                      >
                        <Truck className="size-4" strokeWidth={2.2} aria-hidden />
                        {perluKonfirmasi ? 'Konfirmasi kirim' : 'Lihat penerimaan'}
                      </Link>
                      <UnduhDokumen
                        picklistId={p.publicId}
                        siap={p.pdfReadyAt !== null}
                        ukuran="sm"
                        bentuk="ringkas"
                      />
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          <div className="hidden md:block">
            <Table scroll>
              <thead>
                <tr>
                  <Th sticky="left">Nomor</Th>
                  <Th>Tanggal kirim</Th>
                  <Th>Jam datang</Th>
                  <Th align="right">Cycle</Th>
                  <Th align="right">Line</Th>
                  <Th align="right">Box</Th>
                  <Th>Status</Th>
                  {/* Langkah berikutnya setelah dokumen diunduh (F-30); tanpa ini supplier
                    harus menebak bahwa nomor order bisa diklik. */}
                  <Th>Aksi</Th>
                  {/* Paling kanan: tombol unduh paling lebar dan paling jarang dibaca berurutan. */}
                  <Th align="center" sticky="right">
                    Download
                  </Th>
                </tr>
              </thead>
              <tbody>
                {data.length === 0 ? (
                  <EmptyState colSpan={9}>
                    Belum ada order berjalan. Order baru muncul di sini begitu PPIC menerbitkannya,
                    dan Anda akan menerima email pemberitahuan.
                  </EmptyState>
                ) : (
                  data.map((p) => (
                    <ClickableRow key={p.id} href={`/portal/${p.publicId}`}>
                      <Td strong sticky="left" className="tabular whitespace-nowrap">
                        <Link href={`/portal/${p.publicId}`} className="hover:underline">
                          {orderSheetDisplayNo(p.picklistNo, p.revision)}
                        </Link>
                        {p.downloadedAt === null ? (
                          <span className="ml-2 rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[11px] font-semibold text-accent">
                            baru
                          </span>
                        ) : null}
                      </Td>
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
                        {p.cycle}
                      </Td>
                      <Td align="right" className="tabular">
                        {p.lineCount}
                      </Td>
                      <Td align="right" className="tabular">
                        {p.boxOrdered}
                      </Td>
                      <Td>
                        <span
                          className={cn(
                            'inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-1 text-[12px] font-semibold',
                            STATUS_TONE[p.status] ?? 'border-line',
                          )}
                        >
                          {STATUS_LABEL[p.status] ?? p.status}
                        </span>
                      </Td>
                      <Td className="whitespace-nowrap">
                        {p.status === 'ISSUED' || p.status === 'DOWNLOADED' ? (
                          <Link
                            href={`/portal/${p.publicId}`}
                            className="inline-flex h-9 items-center gap-1.5 rounded-full bg-accent px-4 text-[13px] font-semibold text-white transition-colors hover:bg-accent-soft"
                          >
                            <Truck className="size-4" strokeWidth={2.2} aria-hidden />
                            Konfirmasi kirim
                          </Link>
                        ) : (
                          <Link
                            href={`/portal/${p.publicId}`}
                            className="text-[13px] font-semibold text-ink-muted transition-colors hover:text-ink hover:underline"
                          >
                            Lihat detail
                          </Link>
                        )}
                      </Td>
                      <Td align="center" sticky="right" className="whitespace-nowrap">
                        <UnduhDokumen
                          picklistId={p.publicId}
                          siap={p.pdfReadyAt !== null}
                          ukuran="sm"
                          bentuk="ringkas"
                        />
                      </Td>
                    </ClickableRow>
                  ))
                )}
              </tbody>
            </Table>
          </div>
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

function MobileInfo({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof CalendarDays;
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0">
      <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
        <Icon className="size-3.5 shrink-0" strokeWidth={1.9} aria-hidden />
        {label}
      </span>
      <span className="mt-1 block truncate font-semibold tabular text-ink">{value}</span>
    </div>
  );
}
