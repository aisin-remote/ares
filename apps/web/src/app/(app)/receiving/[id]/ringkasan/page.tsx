import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  AlertTriangle,
  Building2,
  CalendarClock,
  ClipboardList,
  DoorClosed,
  FileText,
  Printer,
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
import { requirePermission } from '@/lib/session';
import { orderSheetDisplayNo } from '@ares/domain';

export const dynamic = 'force-dynamic';

const OUTBOX_LABEL: Record<string, string> = {
  PENDING: 'Menunggu kirim ke SAP',
  PROCESSING: 'Sedang dikirim',
  STAGED: 'Masuk staging SAP',
  POSTED: 'Berhasil diposting di SAP',
  FAILED: 'Gagal kirim ke SAP',
  HELD: 'Ditahan',
  SKIPPED: 'Tidak dikirim (tidak ada pcs)',
};

const OUTBOX_TONE: Record<string, string> = {
  PENDING: 'border-accent/40 bg-accent/10 text-accent',
  PROCESSING: 'border-live/40 bg-live/10 text-live',
  STAGED: 'border-accent/40 bg-accent/10 text-accent',
  POSTED: 'border-ok/40 bg-ok/10 text-ok',
  FAILED: 'border-ng/40 bg-ng/10 text-ng',
  HELD: 'border-warn/40 bg-warn/10 text-warn',
  SKIPPED: 'border-line text-ink-muted',
};

/** Ringkasan satu receipt (6.5.3): apa yang diterima, apa yang hilang, dan nasib GR-nya. */
export default async function ReceiptSummaryPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission('receipt.read');
  if (user.plantId == null) notFound();
  const { id } = await params;
  const r = await getReceiptDetail(id, user.plantId);
  if (!r) notFound();

  const totalOrdered = r.lines.reduce((n, l) => n + l.boxOrdered, 0);
  const totalScanned = r.lines.reduce((n, l) => n + l.boxScanned, 0);
  const totalMissing = r.lines.reduce((n, l) => n + l.boxMissing, 0);
  const totalPcs = r.lines.reduce((n, l) => n + l.pcsReceived, 0);
  const orderNo = orderSheetDisplayNo(r.picklistNo, r.revision);

  if (user.role === 'warehouse') {
    return (
      <div className="space-y-4">
        <Link
          href="/receiving"
          className="inline-flex min-h-11 items-center text-[14px] font-semibold text-ink-muted hover:text-ink"
        >
          ← Kembali ke Receiving
        </Link>
        <div>
          <h1 className="text-[24px] font-extrabold tracking-tight">Hasil penerimaan</h1>
          <p className="tabular mt-1 text-[13px] text-ink-muted">{r.receiptNo}</p>
        </div>
        <Card className="space-y-2 p-4">
          <h2 className="text-[16px] font-bold">{r.vendorName}</h2>
          <p className="tabular text-[15px] font-semibold">{orderNo}</p>
          <p className="text-[13px] text-ink-muted">
            {r.status === 'OPEN'
              ? 'Sesi masih terbuka'
              : r.status === 'CANCELLED'
                ? 'Sesi dibatalkan'
                : 'Sesi sudah ditutup'}
          </p>
          <p className="text-[12px] text-ink-muted">
            Dibuka {waktu(r.openedAt)}
            {r.closedAt ? ` · ditutup ${waktu(r.closedAt)}` : ''}
          </p>
          {r.closedBy ? <p className="text-[12px] text-ink-muted">Petugas: {r.closedBy}</p> : null}
        </Card>
        <dl className="grid grid-cols-3 gap-2">
          <div className="rounded-2xl border border-line bg-card p-3">
            <dt className="text-[11px] text-ink-muted">Box diterima</dt>
            <dd className="tabular mt-1 text-[24px] font-extrabold text-ok">
              {totalScanned}
              <span className="text-[12px] font-normal text-ink-muted"> / {totalOrdered}</span>
            </dd>
          </div>
          <div className="rounded-2xl border border-line bg-card p-3">
            <dt className="text-[11px] text-ink-muted">Box kurang</dt>
            <dd className="tabular mt-1 text-[24px] font-extrabold text-warn">{totalMissing}</dd>
          </div>
          <div className="rounded-2xl border border-line bg-card p-3">
            <dt className="text-[11px] text-ink-muted">Pcs diterima</dt>
            <dd className="tabular mt-1 text-[24px] font-extrabold">{totalPcs}</dd>
          </div>
        </dl>
        {r.note ? (
          <Card className="p-4">
            <h2 className="text-[14px] font-bold">Catatan penerimaan</h2>
            <p className="mt-2 whitespace-pre-wrap break-words text-[14px] text-ink-muted">
              {r.note}
            </p>
          </Card>
        ) : null}
        <section className="space-y-3" aria-labelledby="receipt-parts">
          <h2 id="receipt-parts" className="text-[17px] font-bold">
            Part diterima
          </h2>
          {r.lines.map((line) => (
            <Card key={line.id} className="p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-[17px] font-extrabold">{line.backNo}</h3>
                <span className="tabular text-[13px] font-semibold">{line.partNo}</span>
              </div>
              <p className="mt-1 break-words text-[13px] text-ink-muted">{line.partName}</p>
              <dl className="mt-3 grid grid-cols-3 gap-2 text-[12px]">
                <div>
                  <dt className="text-ink-muted">Diorder</dt>
                  <dd className="tabular mt-1 font-bold">{line.boxOrdered} box</dd>
                </div>
                <div>
                  <dt className="text-ink-muted">Diterima</dt>
                  <dd className="tabular mt-1 font-bold text-ok">{line.boxScanned} box</dd>
                </div>
                <div>
                  <dt className="text-ink-muted">Kurang</dt>
                  <dd className="tabular mt-1 font-bold text-warn">{line.boxMissing} box</dd>
                </div>
              </dl>
            </Card>
          ))}
        </section>
        {r.outbox ? (
          <p className="rounded-2xl border border-line bg-card p-3 text-[12px] text-ink-muted">
            {OUTBOX_LABEL[r.outbox.status] ?? r.outbox.status}
            {r.outbox.sapDocNumber ? ` · ${r.outbox.sapDocNumber}` : ''}
          </p>
        ) : null}
        <Link
          href={r.status === 'OPEN' ? `/receiving/${r.publicId}` : '/receiving'}
          className="flex min-h-12 items-center justify-center gap-2 rounded-full bg-accent px-4 text-[14px] font-semibold text-white hover:bg-accent-soft"
        >
          <ScanLine className="size-4" aria-hidden />
          {r.status === 'OPEN' ? 'Lanjutkan scan' : 'Scan Delivery Sheet berikutnya'}
        </Link>
      </div>
    );
  }

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
              href={`/receiving/${r.publicId}`}
              className="inline-flex h-11 items-center gap-2 rounded-full bg-accent px-5 text-[14px] font-semibold text-white transition-colors hover:bg-accent-soft"
            >
              <ScanLine className="size-[18px]" strokeWidth={2.2} aria-hidden />
              Lanjutkan sesi
            </Link>
          ) : (
            <>
              {r.status === 'CLOSED' ? (
                // Dirender worker saat sesi ditutup; tautan biasa supaya "buka di tab baru" tetap jalan.
                <a
                  href={`/api/receipt/${r.publicId}/sheet`}
                  className="inline-flex h-11 items-center gap-2 rounded-full border border-line bg-card px-5 text-[14px] font-semibold transition-colors hover:border-ink"
                >
                  <Printer className="size-[18px]" strokeWidth={2} aria-hidden />
                  Receipt Sheet
                </a>
              ) : null}
              <Link
                href={`/picklist/${r.picklistPublicId}`}
                className="inline-flex h-11 items-center gap-2 rounded-full border border-line bg-card px-5 text-[14px] font-semibold transition-colors hover:border-ink"
              >
                <ClipboardList className="size-[18px]" strokeWidth={2} aria-hidden />
                Order Sheet<span className="hidden sm:inline"> {orderNo}</span>
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
                  Order Sheet {STATUS_LABEL[r.picklistStatus] ?? r.picklistStatus}
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
                      : 'GR menunggu diproses'}
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
            title="Line Order Sheet"
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
