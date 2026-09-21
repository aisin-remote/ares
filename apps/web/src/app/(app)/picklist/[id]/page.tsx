import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  Building2,
  CalendarClock,
  ClipboardList,
  FileText,
  Layers,
  Loader2,
  Printer,
  QrCode,
  Truck,
} from 'lucide-react';
import { canTransition } from '@ares/domain';
import { getPicklistDetail } from '@/lib/queries';
import { getSessionUser } from '@/lib/session';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader, CardDivider } from '@/components/ui/card';
import { InfoRow, InfoRowPair } from '@/components/ui/info-row';
import { Table, Th, Td, Tr, EmptyState } from '@/components/ui/table';
import { Reveal } from '@/components/motion/reveal';
import { CancelPicklist } from '@/components/picklist/cancel-picklist';
import {
  LINE_STATUS_LABEL,
  STATUS_LABEL,
  STATUS_TONE,
  jam,
  tanggal,
  waktu,
} from '@/components/picklist/status';
import { cn } from '@/components/ui/cn';

export const dynamic = 'force-dynamic';

/** Detail satu picklist beserta line dan jumlah kanbannya (F-21, F-22). */
export default async function PicklistDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Segmen [id] menangkap teks apa pun; tanpa penjagaan ini /picklist/abc
  // menjadi `WHERE ID = NaN` dan berakhir 500, bukan 404.
  const picklistId = Number(id);
  if (!Number.isInteger(picklistId) || picklistId <= 0) notFound();

  const sesi = await getSessionUser();
  const picklist = await getPicklistDetail(sesi?.vendorId ?? null, picklistId);
  if (!picklist) notFound();

  const totalKanban = picklist.lines.reduce((n, l) => n + l.kanbanCount, 0);
  // Boleh dibatalkan atau tidak ditentukan tabel transisi di domain (6.6.3),
  // bukan daftar status yang ditulis ulang di layar.
  const bisaBatal = canTransition('picklist', picklist.status, 'CANCELLED');

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Picklist', href: '/picklist' }, { label: picklist.picklistNo }]}
        title={picklist.picklistNo}
        description={`${picklist.vendorName} — kirim ${tanggal(picklist.deliveryDate)} jam ${jam(picklist.arrivalTime)}`}
        actions={
          /*
           * Tautan biasa, bukan Button: Button komponen klien dan prop ikonnya
           * berupa fungsi yang tidak bisa menyeberangi batas RSC. Unduhan juga
           * memang cocok sebagai <a> — klik kanan "simpan sebagai" tetap jalan.
           */
          picklist.pdfReadyAt && picklist.status !== 'CANCELLED' ? (
            <>
              <a
                href={`/api/picklist/${picklist.id}/pdf`}
                className="inline-flex h-11 items-center gap-2 rounded-full border border-line bg-card px-5 text-[14px] font-semibold transition-colors hover:border-ink"
              >
                <Printer className="size-[18px]" strokeWidth={2} aria-hidden />
                PDF picklist
              </a>
              <a
                href={`/api/picklist/${picklist.id}/kanban`}
                className="inline-flex h-11 items-center gap-2 rounded-full bg-accent px-5 text-[14px] font-semibold text-white transition-colors hover:bg-accent-soft"
              >
                <QrCode className="size-[18px]" strokeWidth={2.2} aria-hidden />
                PDF kanban
              </a>
            </>
          ) : (
            <span className="inline-flex h-11 items-center gap-2 rounded-full border border-line px-5 text-[14px] font-semibold text-ink-muted">
              {picklist.status === 'CANCELLED' ? (
                'Order dibatalkan — dokumen tidak bisa dicetak'
              ) : (
                <>
                  <Loader2 className="size-4 animate-spin" strokeWidth={2} aria-hidden />
                  PDF sedang dibuat…
                </>
              )}
            </span>
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
            actions={bisaBatal ? <CancelPicklist id={picklist.id} /> : null}
          />
          <CardDivider />
          <InfoRowPair>
            <InfoRow icon={Building2} label="Supplier">
              {picklist.vendorName}
              <span className="tabular text-ink-muted">({picklist.sapVendorNo})</span>
            </InfoRow>
            <InfoRow icon={CalendarClock} label="Kedatangan">
              {tanggal(picklist.deliveryDate)} jam {jam(picklist.arrivalTime)} · cycle{' '}
              {picklist.cycle}
            </InfoRow>
            <InfoRow icon={Layers} label="Isi">
              {picklist.lines.length} line · {totalKanban} kanban ·{' '}
              {picklist.type === 'MANUAL' ? 'order manual' : 'dari cutoff'}
              {picklist.revision > 0 ? ` · revisi ${picklist.revision}` : ''}
            </InfoRow>
            <InfoRow icon={Truck} label="Pengiriman supplier">
              {picklist.shippedAt
                ? `${waktu(picklist.shippedAt)}${picklist.vehicleNo ? ` · ${picklist.vehicleNo}` : ''}`
                : 'Belum dikonfirmasi'}
            </InfoRow>
            <InfoRow icon={FileText} label="Dibuat">
              {waktu(picklist.createdAt)}
              {picklist.downloadedAt ? ` · diunduh ${waktu(picklist.downloadedAt)}` : ''}
            </InfoRow>
            {picklist.note ? (
              <InfoRow icon={FileText} label="Catatan">
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
            title="Line order"
            subtitle={`${picklist.lines.length} part — kanban dicetak satu per box (F-22)`}
          />
          <Table>
            <thead>
              <tr>
                <Th>Part</Th>
                <Th>Back no</Th>
                <Th>Rak</Th>
                <Th>PO item</Th>
                <Th align="right">Box</Th>
                <Th align="right">Kirim</Th>
                <Th align="right">Terima</Th>
                <Th align="right">Pcs</Th>
                <Th align="right">Kanban</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {picklist.lines.length === 0 ? (
                <EmptyState colSpan={10}>
                  Picklist ini tidak punya line — seharusnya tidak mungkin terjadi.
                </EmptyState>
              ) : (
                picklist.lines.map((l) => (
                  <Tr key={l.id}>
                    <Td strong className="whitespace-nowrap">
                      <span className="tabular">{l.partNo}</span>
                      <span className="ml-2 font-normal text-ink-muted">{l.partName}</span>
                    </Td>
                    <Td className="tabular">{l.backNo}</Td>
                    <Td className="tabular">{l.rack ?? '—'}</Td>
                    <Td className="tabular whitespace-nowrap">
                      {l.sapPoNo}
                      <span className="text-ink-muted"> / {l.sapPoItem}</span>
                    </Td>
                    <Td align="right" className="tabular">
                      {l.boxOrdered}
                    </Td>
                    <Td align="right" className="tabular">
                      {l.boxShipped ?? '—'}
                    </Td>
                    <Td align="right" className="tabular">
                      {l.boxReceived}
                    </Td>
                    <Td align="right" className="tabular">
                      {l.pcs}
                    </Td>
                    <Td align="right" className="tabular">
                      {l.kanbanCount}
                    </Td>
                    <Td>{LINE_STATUS_LABEL[l.status] ?? l.status}</Td>
                  </Tr>
                ))
              )}
            </tbody>
          </Table>
        </Card>
      </Reveal>

      <p className="mt-5 text-[14px] text-ink-muted">
        <Link href="/picklist" className="font-semibold text-ink hover:underline">
          Kembali ke daftar
        </Link>
        {picklist.status === 'CANCELLED'
          ? ' · Order dibatalkan; PDF-nya tidak lagi dilayani (F-20).'
          : picklist.pdfReadyAt
            ? ` · PDF dibuat ${waktu(picklist.pdfReadyAt)}, dicetak ulang tanpa dihitung ulang (F-27).`
            : ' · PDF dirender di latar belakang; muat ulang halaman ini sebentar lagi.'}
      </p>
    </>
  );
}
