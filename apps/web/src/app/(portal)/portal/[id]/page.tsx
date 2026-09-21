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
import { ConfirmShipmentForm } from '@/components/portal/confirm-shipment-form';
import { LINE_STATUS_LABEL } from '@/components/picklist/status';
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
  // 6.3.4: form konfirmasi hanya sebelum SHIPPED; sesudahnya angkanya beku di layar ini.
  const bisaKonfirmasi = picklist.status === 'ISSUED' || picklist.status === 'DOWNLOADED';
  const sudahKirim = picklist.shippedAt !== null;

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
                ? `${waktu(picklist.shippedAt)}${picklist.vehicleNo ? ` · ${picklist.vehicleNo}` : ''}${picklist.eta ? ` · ETA ${waktu(picklist.eta)}` : ''}`
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
            icon={bisaKonfirmasi ? Truck : Layers}
            title={bisaKonfirmasi ? 'Konfirmasi kirim' : 'Yang dikirim'}
            subtitle={
              bisaKonfirmasi
                ? 'Isi box yang benar-benar naik truk per part, ETA, dan nomor kendaraan (F-30)'
                : sudahKirim
                  ? 'Jumlah kirim sudah dikonfirmasi dan tidak bisa diubah dari portal; perubahan lewat PPIC'
                  : 'Satu kanban per box — tempelkan kartunya pada box yang sesuai'
            }
          />
          {bisaKonfirmasi ? (
            <ConfirmShipmentForm
              picklistId={picklist.id}
              lines={picklist.lines.map((l) => ({
                id: l.id,
                partNo: l.partNo,
                partName: l.partName,
                backNo: l.backNo,
                boxOrdered: l.boxOrdered,
                qtyPerBox: l.qtyPerBox,
              }))}
              defaultEta={`${picklist.deliveryDate}T${jam(picklist.arrivalTime)}`}
            />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Part</Th>
                  <Th>Back no</Th>
                  <Th align="right">Qty/box</Th>
                  <Th align="right">Diorder</Th>
                  <Th align="right">Dikirim</Th>
                  <Th align="right">Pcs</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {picklist.lines.length === 0 ? (
                  <EmptyState colSpan={7}>
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
                      <Td
                        align="right"
                        className={cn(
                          'tabular font-semibold',
                          l.boxShipped !== null && l.boxShipped < l.boxOrdered
                            ? 'text-warn'
                            : 'text-ink',
                        )}
                      >
                        {l.boxShipped ?? '—'}
                      </Td>
                      <Td align="right" className="tabular">
                        {(l.boxShipped ?? l.boxOrdered) * l.qtyPerBox}
                      </Td>
                      <Td>{LINE_STATUS_LABEL[l.status] ?? l.status}</Td>
                    </Tr>
                  ))
                )}
              </tbody>
            </Table>
          )}
        </Card>
      </Reveal>

      <p className="mt-5 text-[14px] text-ink-muted">
        <Link href="/portal" className="font-semibold text-ink hover:underline">
          Kembali ke daftar order
        </Link>
        {sudahKirim
          ? ' · Bila jumlah kirim perlu diubah setelah konfirmasi, hubungi PPIC (6.3.4).'
          : ''}
      </p>
    </>
  );
}
