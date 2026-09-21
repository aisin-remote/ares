import Link from 'next/link';
import { Boxes, CheckCircle2, ScanLine, Truck } from 'lucide-react';
import { RECEIPT_STATUSES, type ReceiptStatus } from '@ares/contracts';
import { getReceiptCounts, listReceipts } from '@/lib/queries';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { Card, CardHeader, CardBody, CardDivider } from '@/components/ui/card';
import { Table, Th, Td, Tr, EmptyState } from '@/components/ui/table';
import { Reveal, Stagger, StaggerItem } from '@/components/motion/reveal';
import { OpenSessionForm } from '@/components/scan/open-session-form';
import { STATUS_LABEL, STATUS_TONE, waktu } from '@/components/picklist/status';
import { cn } from '@/components/ui/cn';
import { CancelReceipt } from '@/components/scan/cancel-receipt';
import { getSessionUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

const PER_PAGE = 25;

const SESI_LABEL: Record<ReceiptStatus, string> = {
  OPEN: 'Terbuka',
  CLOSED: 'Ditutup',
  CANCELLED: 'Dibatalkan',
};

const SESI_TONE: Record<ReceiptStatus, string> = {
  OPEN: 'border-live/40 bg-live/10 text-live',
  CLOSED: 'border-ok/40 bg-ok/10 text-ok',
  CANCELLED: 'border-line text-ink-muted',
};

/** Penerimaan: daftar sesi scan (F-34) dan pintu masuk ke layar stasiun. */
export default async function ReceivingPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Math.floor(Number(sp.page ?? 1)) || 1);
  const status = sp.status ?? 'ALL';
  const saring = (RECEIPT_STATUSES as readonly string[]).includes(status)
    ? (status as ReceiptStatus)
    : undefined;

  const [hitungan, { data, meta }, user] = await Promise.all([
    getReceiptCounts(),
    listReceipts({ page, perPage: PER_PAGE, status: saring }),
    getSessionUser(),
  ]);

  const tautanHalaman = (p: number) =>
    saring ? `/receiving?status=${saring}&page=${p}` : `/receiving?page=${p}`;

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Penerimaan' }]}
        title="Penerimaan"
        description={`${hitungan.terbuka} sesi scan sedang berjalan · ${hitungan.boxHariIni} box diterima hari ini`}
      />

      {/*
       * Di handheld yang datang ke halaman ini hanya untuk menembak barcode
       * picklist, form dibuat paling atas; kartu angka menyusul di bawahnya.
       * Mulai lg susunannya kembali ke pola halaman daftar (PRD §10.3).
       */}
      <div className="flex flex-col gap-5">
        <Stagger className="order-2 grid gap-5 sm:grid-cols-3 lg:order-1">
          <StaggerItem>
            <StatCard
              label="Sesi terbuka"
              value={hitungan.terbuka}
              hint="masih discan di stasiun"
              icon={ScanLine}
            />
          </StaggerItem>
          <StaggerItem>
            <StatCard
              label="Ditutup hari ini"
              value={hitungan.ditutupHariIni}
              hint="receipt terbentuk, GR ke SAP"
              icon={CheckCircle2}
            />
          </StaggerItem>
          <StaggerItem>
            <StatCard label="Box diterima hari ini" value={hitungan.boxHariIni} icon={Boxes} />
          </StaggerItem>
        </Stagger>

        <Reveal className="order-1 lg:order-2">
          <Card>
            <CardHeader
              icon={ScanLine}
              title="Buka sesi scan"
              subtitle="Scan barcode picklist di lembar order supplier untuk mulai menerima"
            />
            <CardDivider />
            <CardBody>
              <OpenSessionForm />
            </CardBody>
          </Card>
        </Reveal>

        <Reveal delayMs={60} className="order-3">
          <Card>
            <CardHeader
              icon={Truck}
              title="Sesi scan"
              subtitle={`${meta.total} sesi`}
              actions={
                <div className="flex flex-wrap gap-1.5">
                  {['ALL', ...RECEIPT_STATUSES].map((s) => (
                    <Link
                      key={s}
                      href={s === 'ALL' ? '/receiving' : `/receiving?status=${s}`}
                      className={cn(
                        'rounded-full border px-3 py-1 text-[12px] font-semibold transition-colors',
                        status === s
                          ? 'border-ink bg-surface text-ink'
                          : 'border-line text-ink-muted hover:border-ink hover:text-ink',
                      )}
                    >
                      {s === 'ALL' ? 'Semua' : SESI_LABEL[s as ReceiptStatus]}
                    </Link>
                  ))}
                </div>
              }
            />
            <Table>
              <thead>
                <tr>
                  <Th>Receipt</Th>
                  <Th>Picklist</Th>
                  <Th>Supplier</Th>
                  <Th>Dibuka</Th>
                  <Th align="right">Box discan</Th>
                  <Th>Sesi</Th>
                  <Th>Picklist</Th>
                  <Th>Aksi</Th>
                </tr>
              </thead>
              <tbody>
                {data.length === 0 ? (
                  <EmptyState colSpan={8}>
                    Belum ada sesi scan pada saringan ini. Scan barcode picklist di atas untuk
                    membuka sesi pertama.
                  </EmptyState>
                ) : (
                  data.map((r) => (
                    <Tr key={r.id}>
                      <Td strong className="tabular whitespace-nowrap">
                        <Link
                          href={
                            r.status === 'OPEN'
                              ? `/receiving/${r.id}`
                              : `/receiving/${r.id}/ringkasan`
                          }
                          className="hover:underline"
                        >
                          {r.receiptNo}
                        </Link>
                      </Td>
                      <Td className="tabular whitespace-nowrap">
                        <Link href={`/picklist/${r.picklistId}`} className="hover:underline">
                          {r.picklistNo}
                          {r.revision > 0 ? (
                            <span className="text-ink-muted"> rev {r.revision}</span>
                          ) : null}
                        </Link>
                      </Td>
                      <Td>{r.vendorName}</Td>
                      <Td className="tabular whitespace-nowrap">{waktu(r.openedAt)}</Td>
                      <Td align="right" className="tabular">
                        {r.boxScanned} / {r.boxOrdered}
                      </Td>
                      <Td>
                        <span
                          className={cn(
                            'inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-1 text-[12px] font-semibold',
                            SESI_TONE[r.status],
                          )}
                        >
                          {SESI_LABEL[r.status]}
                        </span>
                      </Td>
                      <Td>
                        <span
                          className={cn(
                            'inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-1 text-[12px] font-semibold',
                            STATUS_TONE[r.picklistStatus] ?? 'border-line',
                          )}
                        >
                          {STATUS_LABEL[r.picklistStatus] ?? r.picklistStatus}
                        </span>
                      </Td>
                      <Td>
                        {r.status !== 'CANCELLED' && r.grStatus !== 'SENT' &&
                        (user?.role === 'admin' || user?.role === 'warehouse') ? (
                          <CancelReceipt id={r.id} />
                        ) : r.grStatus === 'SENT' ? (
                          <span className="text-[12px] text-ink-muted">GR terkirim</span>
                        ) : '—'}
                      </Td>
                    </Tr>
                  ))
                )}
              </tbody>
            </Table>
          </Card>
        </Reveal>
      </div>

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
