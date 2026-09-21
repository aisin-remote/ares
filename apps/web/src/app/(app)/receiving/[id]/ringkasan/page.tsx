import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  AlertTriangle,
  Building2,
  CalendarClock,
  ClipboardList,
  DoorClosed,
  FileText,
  ScanLine,
  Share2,
  UserRound,
} from 'lucide-react';
import { getReceiptDetail } from '@/lib/queries';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader, CardDivider } from '@/components/ui/card';
import { InfoRow, InfoRowPair } from '@/components/ui/info-row';
import { Table, Th, Td, Tr } from '@/components/ui/table';
import { Reveal } from '@/components/motion/reveal';
import { STATUS_LABEL, STATUS_TONE, jam, tanggal, waktu } from '@/components/picklist/status';
import { cn } from '@/components/ui/cn';

export const dynamic = 'force-dynamic';

const OUTBOX_LABEL: Record<string, string> = {
  PENDING: 'Menunggu kirim ke SAP',
  SENT: 'Terkirim ke SAP',
  FAILED: 'Gagal kirim ke SAP',
  HELD: 'Ditahan',
  SKIPPED: 'Tidak dikirim (tidak ada pcs)',
};

const OUTBOX_TONE: Record<string, string> = {
  PENDING: 'border-accent/40 bg-accent/10 text-accent',
  SENT: 'border-ok/40 bg-ok/10 text-ok',
  FAILED: 'border-ng/40 bg-ng/10 text-ng',
  HELD: 'border-warn/40 bg-warn/10 text-warn',
  SKIPPED: 'border-line text-ink-muted',
};

/** Ringkasan satu receipt (6.5.3): apa yang diterima, apa yang hilang, dan nasib GR-nya. */
export default async function ReceiptSummaryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const receiptId = Number(id);
  if (!Number.isInteger(receiptId) || receiptId <= 0) notFound();

  const r = await getReceiptDetail(receiptId);
  if (!r) notFound();

  const totalOrdered = r.lines.reduce((n, l) => n + l.boxOrdered, 0);
  const totalScanned = r.lines.reduce((n, l) => n + l.boxScanned, 0);
  const totalMissing = r.lines.reduce((n, l) => n + l.boxMissing, 0);
  const totalPcs = r.lines.reduce((n, l) => n + l.pcsReceived, 0);

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Penerimaan', href: '/receiving' }, { label: r.receiptNo }]}
        title={r.receiptNo}
        description={
          r.status === 'OPEN'
            ? 'Sesi masih terbuka — belum ada receipt'
            : `${totalScanned} dari ${totalOrdered} box diterima · ${totalPcs} pcs masuk stok WH`
        }
        actions={
          r.status === 'OPEN' ? (
            <Link
              href={`/receiving/${r.id}`}
              className="inline-flex h-11 items-center gap-2 rounded-full bg-accent px-5 text-[14px] font-semibold text-white transition-colors hover:bg-accent-soft"
            >
              <ScanLine className="size-[18px]" strokeWidth={2.2} aria-hidden />
              Lanjutkan sesi
            </Link>
          ) : (
            <>
              <Link
                href={`/picklist/${r.picklistId}`}
                className="inline-flex h-11 items-center gap-2 rounded-full border border-line bg-card px-5 text-[14px] font-semibold transition-colors hover:border-ink"
              >
                <ClipboardList className="size-[18px]" strokeWidth={2} aria-hidden />
                Picklist<span className="hidden sm:inline"> {r.picklistNo}</span>
              </Link>
              <Link
                href="/sap"
                className="inline-flex h-11 items-center gap-2 rounded-full bg-accent px-5 text-[14px] font-semibold text-white transition-colors hover:bg-accent-soft"
              >
                <Share2 className="size-[18px]" strokeWidth={2.2} aria-hidden />
                SAP outbox
              </Link>
            </>
          )
        }
      />

      <Reveal>
        <Card>
          <CardHeader
            icon={FileText}
            title="Keterangan receipt"
            subtitle={
              <span className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    'inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-1 text-[12px] font-semibold',
                    STATUS_TONE[r.picklistStatus] ?? 'border-line',
                  )}
                >
                  Picklist {STATUS_LABEL[r.picklistStatus] ?? r.picklistStatus}
                </span>
                {r.status === 'CLOSED' ? (
                  <span
                    className={cn(
                      'inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-1 text-[12px] font-semibold',
                      r.outbox ? OUTBOX_TONE[r.outbox.status] : 'border-line text-ink-muted',
                    )}
                  >
                    {r.outbox
                      ? `${OUTBOX_LABEL[r.outbox.status] ?? r.outbox.status}${r.outbox.sapDocNumber ? ` · ${r.outbox.sapDocNumber}` : ''}`
                      : 'GR menunggu dipungut worker'}
                  </span>
                ) : null}
              </span>
            }
          />
          <CardDivider />
          <InfoRowPair>
            <InfoRow icon={Building2} label="Supplier">
              {r.vendorName}
            </InfoRow>
            <InfoRow icon={CalendarClock} label="Jadwal kedatangan">
              {tanggal(r.deliveryDate)} jam {jam(r.arrivalTime)} · cycle {r.cycle}
            </InfoRow>
            <InfoRow icon={DoorClosed} label="Sesi">
              dibuka {waktu(r.openedAt)}
              {r.closedAt ? ` · ditutup ${waktu(r.closedAt)}` : ' · masih terbuka'}
            </InfoRow>
            <InfoRow icon={UserRound} label="Ditutup oleh">
              {r.closedBy ?? '—'}
            </InfoRow>
          </InfoRowPair>
          {r.note ? (
            <>
              <CardDivider />
              <InfoRow icon={AlertTriangle} label="Alasan box kurang">
                {r.note}
              </InfoRow>
            </>
          ) : null}
          {r.outbox?.status === 'FAILED' && r.outbox.lastError ? (
            <>
              <CardDivider />
              <InfoRow icon={Share2} label="Pesan SAP">
                <span className="text-ng">{r.outbox.lastError}</span>
              </InfoRow>
            </>
          ) : null}
        </Card>
      </Reveal>

      <Reveal delayMs={60} className="mt-5">
        <Card>
          <CardHeader
            icon={ClipboardList}
            title="Line picklist"
            subtitle={
              totalMissing > 0
                ? `${totalMissing} box belum datang — ditandai hilang, menunggu revisi atau cutoff berikutnya`
                : 'Semua box diterima'
            }
          />
          <Table>
            <thead>
              <tr>
                <Th>Part</Th>
                <Th>Back no.</Th>
                <Th align="right">Diorder</Th>
                <Th align="right">Dikirim</Th>
                <Th align="right">Diterima sesi ini</Th>
                <Th align="right">Pcs</Th>
                <Th align="right">Hilang</Th>
              </tr>
            </thead>
            <tbody>
              {r.lines.map((l) => (
                <Tr key={l.id}>
                  <Td strong>
                    {l.partNo}
                    <div className="text-[13px] font-normal text-ink-muted">{l.partName}</div>
                  </Td>
                  <Td className="font-extrabold text-ink">{l.backNo}</Td>
                  <Td align="right" className="tabular">
                    {l.boxOrdered}
                  </Td>
                  <Td align="right" className="tabular">
                    {l.boxShipped ?? '—'}
                  </Td>
                  <Td
                    align="right"
                    className={cn(
                      'tabular font-bold',
                      l.boxScanned > 0 ? 'text-ok' : 'text-ink-muted',
                    )}
                  >
                    {l.boxScanned}
                  </Td>
                  <Td align="right" className="tabular">
                    {l.pcsReceived}
                  </Td>
                  <Td
                    align="right"
                    className={cn(
                      'tabular font-bold',
                      l.boxMissing > 0 ? 'text-warn' : 'text-ink-muted',
                    )}
                  >
                    {l.boxMissing}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </Reveal>
    </>
  );
}
