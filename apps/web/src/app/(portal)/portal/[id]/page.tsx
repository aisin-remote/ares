import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { CalendarClock, ClipboardList, FileText, Layers, Truck } from 'lucide-react';
import { getPicklistDetail } from '@/lib/queries';
import { getSessionUser } from '@/lib/session';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader, CardDivider } from '@/components/ui/card';
import { InfoRow, InfoRowPair } from '@/components/ui/info-row';
import { Table, Th, Td, Tr, EmptyState } from '@/components/ui/table';
import { Reveal } from '@/components/motion/reveal';
import { UnduhDokumen } from '@/components/portal/unduh-dokumen';
import { STATUS_LABEL, STATUS_TONE, jam, tanggal, waktu } from '@/components/picklist/status';
import { cn } from '@/components/ui/cn';

export const dynamic = 'force-dynamic';

/**
 * Detail satu order di portal supplier.
 *
 * Bedanya dengan layar PPIC: tidak ada tombol batal, dan nomor picklist orang
 * lain tidak bisa dibuka — bukan karena tombolnya disembunyikan, melainkan
 * karena query-nya menyaring dengan vendorId sesi (aturan repo 9).
 */
export default async function PortalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const sesi = await getSessionUser();
  if (sesi?.vendorId == null) redirect('/login');

  const { id } = await params;
  const picklistId = Number(id);
  if (!Number.isInteger(picklistId) || picklistId <= 0) notFound();

  const picklist = await getPicklistDetail(sesi.vendorId, picklistId);
  if (!picklist) notFound();

  const totalKanban = picklist.lines.reduce((n, l) => n + l.kanbanCount, 0);
  const totalBox = picklist.lines.reduce((n, l) => n + l.boxOrdered, 0);

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Order berjalan', href: '/portal' }, { label: picklist.picklistNo }]}
        title={picklist.picklistNo}
        description={`Kirim ${tanggal(picklist.deliveryDate)} jam ${jam(picklist.arrivalTime)} · cycle ${picklist.cycle}`}
        actions={
          picklist.status === 'CANCELLED' ? (
            <span className="inline-flex h-11 items-center rounded-full border border-line px-5 text-[14px] font-semibold text-ink-muted">
              Order dibatalkan pabrik
            </span>
          ) : (
            <UnduhDokumen picklistId={picklist.id} siap={picklist.pdfReadyAt !== null} />
          )
        }
      />

      <Reveal>
        <Card>
          <CardHeader
            icon={ClipboardList}
            title="Keterangan order"
            subtitle={
              <span
                className={cn(
                  'inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-1 text-[12px] font-semibold',
                  STATUS_TONE[picklist.status] ?? 'border-line',
                )}
              >
                {STATUS_LABEL[picklist.status] ?? picklist.status}
              </span>
            }
          />
          <CardDivider />
          <InfoRowPair>
            <InfoRow icon={CalendarClock} label="Harus tiba">
              {tanggal(picklist.deliveryDate)} jam {jam(picklist.arrivalTime)} · cycle{' '}
              {picklist.cycle}
            </InfoRow>
            <InfoRow icon={Layers} label="Muatan">
              {picklist.lines.length} part · {totalBox} box · {totalKanban} kanban
            </InfoRow>
            <InfoRow icon={FileText} label="Diunduh">
              {picklist.downloadedAt ? waktu(picklist.downloadedAt) : 'Belum pernah diunduh'}
            </InfoRow>
            <InfoRow icon={Truck} label="Konfirmasi kirim">
              {picklist.shippedAt
                ? `${waktu(picklist.shippedAt)}${picklist.vehicleNo ? ` · ${picklist.vehicleNo}` : ''}`
                : 'Belum dikonfirmasi'}
            </InfoRow>
            {picklist.note ? (
              <InfoRow icon={FileText} label="Catatan dari PPIC">
                {picklist.note}
              </InfoRow>
            ) : null}
          </InfoRowPair>
        </Card>
      </Reveal>

      <Reveal className="mt-5">
        <Card>
          <CardHeader
            icon={Layers}
            title="Yang harus dikirim"
            subtitle="Satu kanban per box — tempelkan kartunya pada box yang sesuai"
          />
          <Table>
            <thead>
              <tr>
                <Th>Part</Th>
                <Th>Back no</Th>
                <Th align="right">Qty/box</Th>
                <Th align="right">Box</Th>
                <Th align="right">Pcs</Th>
                <Th align="right">Kanban</Th>
              </tr>
            </thead>
            <tbody>
              {picklist.lines.length === 0 ? (
                <EmptyState colSpan={6}>
                  Order ini tidak punya baris. Hubungi PPIC — seharusnya tidak mungkin terjadi.
                </EmptyState>
              ) : (
                picklist.lines.map((l) => (
                  <Tr key={l.id}>
                    <Td strong className="whitespace-nowrap">
                      <span className="tabular">{l.partNo}</span>
                      <span className="ml-2 font-normal text-ink-muted">{l.partName}</span>
                    </Td>
                    <Td className="tabular">{l.backNo}</Td>
                    <Td align="right" className="tabular">
                      {l.qtyPerBox}
                    </Td>
                    <Td align="right" className="tabular">
                      {l.boxOrdered}
                    </Td>
                    <Td align="right" className="tabular">
                      {l.pcs}
                    </Td>
                    <Td align="right" className="tabular">
                      {l.kanbanCount}
                    </Td>
                  </Tr>
                ))
              )}
            </tbody>
          </Table>
        </Card>
      </Reveal>

      <p className="mt-5 text-[14px] text-ink-muted">
        <Link href="/portal" className="font-semibold text-ink hover:underline">
          Kembali ke daftar order
        </Link>
        {' · Konfirmasi kirim (jumlah box, ETA, nomor kendaraan) menyusul di layar ini.'}
      </p>
    </>
  );
}
