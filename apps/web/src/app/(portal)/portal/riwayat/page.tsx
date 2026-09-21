import Link from 'next/link';
import { redirect } from 'next/navigation';
import { BarChart3 } from 'lucide-react';
import { listPicklists } from '@/lib/queries';
import { getSessionUser } from '@/lib/session';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { Table, Th, Td, Tr, EmptyState } from '@/components/ui/table';
import { Reveal } from '@/components/motion/reveal';
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
  if (sesi?.vendorId == null) redirect('/login');

  const sp = await searchParams;
  const page = Math.max(1, Math.floor(Number(sp.page ?? 1)) || 1);

  const { data, meta } = await listPicklists(sesi.vendorId, {
    page,
    perPage: PER_PAGE,
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
          <Table>
            <thead>
              <tr>
                <Th>Nomor</Th>
                <Th>Tanggal kirim</Th>
                <Th>Jam datang</Th>
                <Th align="right">Line</Th>
                <Th align="right">Box</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {data.length === 0 ? (
                <EmptyState colSpan={6}>
                  Belum ada order yang selesai. Order yang sudah diterima gudang pindah ke sini
                  otomatis.
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
