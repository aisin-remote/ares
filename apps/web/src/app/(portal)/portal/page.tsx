import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AlertTriangle, ClipboardList, Download, Send, Truck } from 'lucide-react';
import { getPicklistCounts, listPicklists } from '@/lib/queries';
import { getSessionUser } from '@/lib/session';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { Card, CardHeader } from '@/components/ui/card';
import { Table, Th, Td, Tr, EmptyState } from '@/components/ui/table';
import { Reveal, Stagger, StaggerItem } from '@/components/motion/reveal';
import { UnduhDokumen } from '@/components/portal/unduh-dokumen';
import { STATUS_LABEL, STATUS_TONE, jam, tanggal } from '@/components/picklist/status';
import { cn } from '@/components/ui/cn';

export const dynamic = 'force-dynamic';

const PER_PAGE = 25;

/** Order yang masih berjalan — yang sudah selesai pindah ke halaman riwayat. */
const AKTIF = ['ISSUED', 'DOWNLOADED', 'SHIPPED', 'PARTIAL'] as const;

/** Dashboard portal supplier (F-28). */
export default async function PortalPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const sesi = await getSessionUser();
  if (sesi?.vendorId == null) redirect('/login');
  const scope = sesi.vendorId;

  const sp = await searchParams;
  const page = Math.max(1, Math.floor(Number(sp.page ?? 1)) || 1);

  const [hitungan, { data, meta }] = await Promise.all([
    getPicklistCounts(scope),
    listPicklists(scope, { page, perPage: PER_PAGE, statuses: [...AKTIF] }),
  ]);

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Order berjalan' }]}
        title="Order dari pabrik"
        description={`${meta.total} order berjalan — unduh, cetak kanbannya, lalu kirim sesuai jam kedatangan`}
      />

      <Stagger className="mb-5 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StaggerItem>
          <StatCard label="Order baru" value={hitungan.terbit} hint="belum Anda unduh" icon={Send} />
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
            Ada {hitungan.terlambat} order yang tanggal kirimnya sudah lewat dan belum
            dikonfirmasi. Hubungi PPIC bila barang memang tidak bisa dikirim — pabrik menunggu
            komponen ini di line.
          </span>
        </p>
      ) : null}

      <Reveal>
        <Card>
          <CardHeader
            icon={ClipboardList}
            title="Order berjalan"
            subtitle={`${meta.total} dokumen`}
          />
          <Table>
            <thead>
              <tr>
                <Th>Nomor</Th>
                <Th>Tanggal kirim</Th>
                <Th>Jam datang</Th>
                <Th align="right">Cycle</Th>
                <Th align="right">Line</Th>
                <Th align="right">Box</Th>
                <Th>Status</Th>
                <Th>Dokumen</Th>
              </tr>
            </thead>
            <tbody>
              {data.length === 0 ? (
                <EmptyState colSpan={8}>
                  Belum ada order berjalan. Order baru muncul di sini begitu PPIC menerbitkannya,
                  dan Anda akan menerima email pemberitahuan.
                </EmptyState>
              ) : (
                data.map((p) => (
                  <Tr key={p.id}>
                    <Td strong className="tabular whitespace-nowrap">
                      <Link href={`/portal/${p.id}`} className="hover:underline">
                        {p.picklistNo}
                        {p.revision > 0 ? (
                          <span className="font-normal text-ink-muted"> rev {p.revision}</span>
                        ) : null}
                      </Link>
                      {p.downloadedAt === null ? (
                        <span className="ml-2 rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[11px] font-semibold text-accent">
                          baru
                        </span>
                      ) : null}
                    </Td>
                    <Td className="tabular whitespace-nowrap">{tanggal(p.deliveryDate)}</Td>
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
                    <Td>
                      <UnduhDokumen picklistId={p.id} siap={p.pdfReadyAt !== null} ukuran="sm" />
                    </Td>
                  </Tr>
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
            <Link href={`/portal?page=${meta.page - 1}`} className="font-semibold text-ink hover:underline">
              Sebelumnya
            </Link>
          ) : null}
          {meta.page < meta.totalPages ? (
            <Link href={`/portal?page=${meta.page + 1}`} className="font-semibold text-ink hover:underline">
              Berikutnya
            </Link>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
