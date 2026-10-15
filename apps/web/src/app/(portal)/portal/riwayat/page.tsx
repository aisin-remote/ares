import Link from 'next/link';
import { redirect } from 'next/navigation';
import { BarChart3, Boxes, CalendarDays, Clock3, Eye, FileText } from 'lucide-react';
import { orderSheetDisplayNo } from '@ares/domain';
import { listPicklists } from '@/lib/queries';
import { getSessionUser } from '@/lib/session';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { Table, Th, Td, EmptyState } from '@/components/ui/table';
import { ClickableRow } from '@/components/ui/clickable-row';
import { Reveal } from '@/components/motion/reveal';
import { UnduhDokumen } from '@/components/portal/unduh-dokumen';
import { STATUS_LABEL, STATUS_TONE, jam, tanggal } from '@/components/picklist/status';
import { cn } from '@/components/ui/cn';

export const dynamic = 'force-dynamic';

const PER_PAGE = 25;

/** Order yang sudah tidak ditunggu lagi. PARTIAL sengaja tidak di sini — sisanya masih dinanti. */
const SELESAI = ['COMPLETE', 'CANCELLED'] as const;

/** Riwayat order supplier (F-28 bagian riwayat). */
export default async function RiwayatPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const sesi = await getSessionUser();
  if (sesi?.vendorId == null || sesi.plantId == null) redirect('/login');

  const sp = await searchParams;
  const page = Math.max(1, Math.floor(Number(sp.page ?? 1)) || 1);

  const { data, meta } = await listPicklists(sesi.vendorId, {
    page,
    perPage: PER_PAGE,
    plantId: sesi.plantId,
    statuses: [...SELESAI],
  });

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Riwayat' }]}
        title="Riwayat order"
        description={`${meta.total} order yang sudah selesai atau dibatalkan`}
      />

      <Reveal>
        <Card>
          <CardHeader icon={BarChart3} title="Order selesai" subtitle={`${meta.total} dokumen`} />
          {data.length === 0 ? (
            <div className="border-t border-line px-5 py-10 text-center text-[14px] leading-6 text-ink-muted md:hidden">
              Belum ada order yang selesai. Order yang sudah diterima gudang akan pindah ke sini
              otomatis.
            </div>
          ) : (
            <div className="divide-y divide-line border-t border-line md:hidden">
              {data.map((p) => (
                <article key={p.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <Link
                      href={`/portal/${p.publicId}`}
                      className="min-w-0 truncate font-mono text-[16px] font-bold text-ink"
                    >
                      {orderSheetDisplayNo(p.picklistNo, p.revision)}
                    </Link>
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
                    <RiwayatInfo
                      icon={CalendarDays}
                      label="Tanggal kirim"
                      value={tanggal(p.deliveryDate)}
                    />
                    <RiwayatInfo icon={Clock3} label="Jam datang" value={jam(p.arrivalTime)} />
                    <RiwayatInfo icon={FileText} label="Jumlah part" value={String(p.lineCount)} />
                    <RiwayatInfo icon={Boxes} label="Jumlah box" value={String(p.boxOrdered)} />
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <Link
                      href={`/portal/${p.publicId}`}
                      className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-full border border-line bg-card px-4 text-[13px] font-semibold text-ink hover:border-ink"
                    >
                      <Eye className="size-4" strokeWidth={2} aria-hidden />
                      Lihat detail
                    </Link>
                    {p.status !== 'CANCELLED' ? (
                      <UnduhDokumen
                        picklistId={p.publicId}
                        siap={p.pdfReadyAt !== null}
                        ukuran="sm"
                        bentuk="ringkas"
                      />
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          )}

          <div className="hidden md:block">
            <Table scroll>
              <thead>
                <tr>
                  <Th sticky="left">Nomor</Th>
                  <Th>Tanggal kirim</Th>
                  <Th>Jam datang</Th>
                  <Th align="right">Line</Th>
                  <Th align="right">Box</Th>
                  <Th>Status</Th>
                  {/* Paling kanan, sama dengan daftar order berjalan. */}
                  <Th align="center" sticky="right">
                    Download
                  </Th>
                </tr>
              </thead>
              <tbody>
                {data.length === 0 ? (
                  <EmptyState colSpan={7}>
                    Belum ada order yang selesai. Order yang sudah diterima gudang pindah ke sini
                    otomatis.
                  </EmptyState>
                ) : (
                  data.map((p) => (
                    <ClickableRow key={p.id} href={`/portal/${p.publicId}`}>
                      <Td strong sticky="left" className="tabular whitespace-nowrap">
                        <Link href={`/portal/${p.publicId}`} className="hover:underline">
                          {orderSheetDisplayNo(p.picklistNo, p.revision)}
                        </Link>
                      </Td>
                      <Td className="tabular whitespace-nowrap">{tanggal(p.deliveryDate)}</Td>
                      <Td className="tabular">{jam(p.arrivalTime)}</Td>
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
                      <Td align="center" sticky="right" className="whitespace-nowrap">
                        {p.status !== 'CANCELLED' ? (
                          <UnduhDokumen
                            picklistId={p.publicId}
                            siap={p.pdfReadyAt !== null}
                            ukuran="sm"
                            bentuk="ringkas"
                          />
                        ) : (
                          <span className="text-ink-muted">—</span>
                        )}
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
              href={`/portal/riwayat?page=${meta.page - 1}`}
              className="font-semibold text-ink hover:underline"
            >
              Sebelumnya
            </Link>
          ) : null}
          {meta.page < meta.totalPages ? (
            <Link
              href={`/portal/riwayat?page=${meta.page + 1}`}
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

function RiwayatInfo({
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
