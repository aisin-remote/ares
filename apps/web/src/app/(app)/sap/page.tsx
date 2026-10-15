import Link from 'next/link';
import {
  Share2,
  PauseCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  MinusCircle,
  LoaderCircle,
  Database,
} from 'lucide-react';
import { getSapSummary, listSapOutbox } from '@/lib/sap-api';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { Table, Th, Td, Tr, EmptyState } from '@/components/ui/table';
import { Reveal } from '@/components/motion/reveal';
import { OutboxActions } from '@/components/sap/outbox-actions';
import { cn } from '@/components/ui/cn';
import { requirePermission } from '@/lib/session';

export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Menunggu kirim',
  PROCESSING: 'Sedang dikirim',
  STAGED: 'Masuk staging',
  POSTED: 'Berhasil di SAP',
  FAILED: 'Gagal',
  HELD: 'Ditahan',
  SKIPPED: 'Tidak dikirim',
};

const STATUS_TONE: Record<string, string> = {
  PENDING: 'border-accent/40 bg-accent/10 text-accent',
  PROCESSING: 'border-live/40 bg-live/10 text-live',
  STAGED: 'border-accent/40 bg-accent/10 text-accent',
  POSTED: 'border-ok/40 bg-ok/10 text-ok',
  FAILED: 'border-ng/40 bg-ng/10 text-ng',
  HELD: 'border-warn/40 bg-warn/10 text-warn',
  SKIPPED: 'border-line text-ink-muted',
};

export default async function SapPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    status?: string;
    docType?: string;
    from?: string;
    to?: string;
  }>;
}) {
  await requirePermission('outbox.read');
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const status = sp.status ?? 'ALL';
  const docType = sp.docType ?? 'ALL';
  const from = sp.from ?? '';
  const to = sp.to ?? '';

  const href = (
    next: Partial<{ page: number; status: string; docType: string }>,
    keepDates = true,
  ) => {
    const params = new URLSearchParams();
    const values = { page, status, docType, ...next };
    if (values.page > 1) params.set('page', String(values.page));
    if (values.status !== 'ALL') params.set('status', values.status);
    if (values.docType !== 'ALL') params.set('docType', values.docType);
    if (keepDates && from) params.set('from', from);
    if (keepDates && to) params.set('to', to);
    const query = params.toString();
    return query ? `/sap?${query}` : '/sap';
  };

  const [ringkas, { data, meta }] = await Promise.all([
    getSapSummary(),
    listSapOutbox({ page, perPage: 25, status, docType, from, to }),
  ]);

  const idGagal = data.filter((d) => d.status === 'FAILED').map((d) => d.id);
  const idDitahan = data.filter((d) => d.status === 'HELD').map((d) => d.id);

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Integrasi SAP' }]}
        title="Integrasi SAP"
        description={`Antrean perpindahan barang melalui gateway ${ringkas.gateway}`}
      />

      {/* Keadaan saklar pengiriman ditaruh paling atas: tanpa ini, antrean yang
          menumpuk terlihat seperti kerusakan padahal memang belum dinyalakan. */}
      {!ringkas.pengirimanAktif ? (
        <p className="mb-5 flex items-start gap-2 rounded-card border border-warn/40 bg-warn/10 px-4 py-3 text-[14px] text-warn">
          <PauseCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden />
          <span>
            Gateway <strong>{ringkas.gateway}</strong> belum aktif. Untuk mode mssql, aktifkan{' '}
            <code>SAP_MSSQL_ENABLED</code> setelah staging siap.
            Dokumen tetap dikumpulkan dan menunggu — tidak ada yang hilang. Begitu bentuk tabel
            tujuan dan movement type disepakati tim SAP, seluruh tunggakan terkirim apa adanya.
          </span>
        </p>
      ) : ringkas.gateway === 'fake' ? (
        <p className="mb-5 rounded-card border border-accent/30 bg-accent/10 px-4 py-3 text-[14px] text-accent">
          Mode uji <strong>fake</strong> aktif. Dokumen langsung berstatus berhasil dengan nomor
          FAKE-&lt;id&gt; tanpa menulis ke SAP.
        </p>
      ) : null}

      <Reveal>
        <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          <Kartu icon={Clock} label="Menunggu kirim" nilai={ringkas.pending} tone="accent" />
          <Kartu icon={LoaderCircle} label="Sedang dikirim" nilai={ringkas.processing} tone="live" />
          <Kartu icon={Database} label="Masuk staging" nilai={ringkas.staged} tone="accent" />
          <Kartu icon={CheckCircle2} label="Berhasil di SAP" nilai={ringkas.posted} tone="ok" />
          <Kartu icon={PauseCircle} label="Ditahan" nilai={ringkas.held} tone="warn" />
          <Kartu icon={AlertTriangle} label="Gagal" nilai={ringkas.failed} tone="ng" />
          <Kartu icon={MinusCircle} label="Tidak dikirim" nilai={ringkas.skipped} tone="muted" />
        </div>
      </Reveal>

      <Card className="mb-5 p-4">
        <form action="/sap" method="get" className="flex flex-wrap items-end gap-3">
          {status !== 'ALL' ? <input type="hidden" name="status" value={status} /> : null}
          {docType !== 'ALL' ? <input type="hidden" name="docType" value={docType} /> : null}
          <label className="grid gap-1 text-[12px] font-semibold text-ink-muted">
            Dari tanggal
            <input
              type="date"
              name="from"
              defaultValue={from}
              className="h-10 rounded-xl border border-line bg-surface px-3 text-[14px] text-ink outline-none focus:border-line-strong"
            />
          </label>
          <label className="grid gap-1 text-[12px] font-semibold text-ink-muted">
            Sampai tanggal
            <input
              type="date"
              name="to"
              defaultValue={to}
              className="h-10 rounded-xl border border-line bg-surface px-3 text-[14px] text-ink outline-none focus:border-line-strong"
            />
          </label>
          <button className="h-10 rounded-full bg-accent px-4 text-[13px] font-semibold text-white">
            Terapkan tanggal
          </button>
          {(from || to) ? (
            <Link href={href({ page: 1 }, false)} className="h-10 px-2 py-2.5 text-[13px] font-semibold text-ink-muted hover:text-ink">
              Hapus tanggal
            </Link>
          ) : null}
        </form>
        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-line pt-3">
          {[
            ['ALL', 'Semua jenis'],
            ['GR', 'GR 101'],
            ['GR_REVERSAL', 'Pembatalan GR 102'],
          ].map(([value, label]) => (
            <Link
              key={value}
              href={href({ page: 1, docType: value! })}
              className={cn(
                'rounded-full border px-3 py-1 text-[12px] font-semibold transition-colors',
                docType === value ? 'border-ink bg-surface text-ink' : 'border-line text-ink-muted hover:border-ink',
              )}
            >
              {label}
            </Link>
          ))}
        </div>
      </Card>

      <div className="mb-5">
        <OutboxActions idGagal={idGagal} idDitahan={idDitahan} />
      </div>

      <Reveal>
        <Card>
          <CardHeader
            icon={Share2}
            title="Antrean dokumen"
            subtitle={`${meta.total} dokumen`}
            actions={
              <div className="flex flex-wrap gap-1.5">
                {['ALL', 'PENDING', 'PROCESSING', 'STAGED', 'POSTED', 'HELD', 'FAILED', 'SKIPPED'].map((s) => (
                  <Link
                    key={s}
                    href={href({ page: 1, status: s })}
                    className={cn(
                      'rounded-full border px-3 py-1 text-[12px] font-semibold transition-colors',
                      status === s
                        ? 'border-ink bg-surface text-ink'
                        : 'border-line text-ink-muted hover:border-ink hover:text-ink',
                    )}
                  >
                    {s === 'ALL' ? 'Semua' : STATUS_LABEL[s]}
                  </Link>
                ))}
              </div>
            }
          />
          <Table>
            <thead>
              <tr>
                <Th>Dokumen asal</Th>
                <Th>Jenis</Th>
                <Th>Mvt</Th>
                <Th>Pabrik</Th>
                <Th>Waktu</Th>
                <Th>Status</Th>
                <Th>Keterangan</Th>
              </tr>
            </thead>
            <tbody>
              {data.length === 0 ? (
                <EmptyState colSpan={7}>
                  Belum ada dokumen pada saringan ini. Perpindahan barang dikumpulkan otomatis tiap
                  menit.
                </EmptyState>
              ) : (
                data.map((d) => (
                  <Tr key={d.id}>
                    <Td strong className="tabular whitespace-nowrap">
                      {d.idempotencyKey}
                      <span className="block font-normal text-[11px] text-ink-muted">
                        {d.sourceTable} #{d.sourceId}
                      </span>
                    </Td>
                    <Td>{d.docType}</Td>
                    <Td className="tabular">{d.movementType ?? '—'}</Td>
                    <Td>{d.plantCode ?? '—'}</Td>
                    <Td className="tabular whitespace-nowrap">
                      {new Date(d.occurredAt).toLocaleString('id-ID', {
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </Td>
                    <Td>
                      <span
                        className={cn(
                          'inline-flex items-center rounded-full border px-2.5 py-1 text-[12px] font-semibold whitespace-nowrap',
                          STATUS_TONE[d.status] ?? 'border-line',
                        )}
                      >
                        {STATUS_LABEL[d.status] ?? d.status}
                      </span>
                    </Td>
                    <Td className="max-w-[340px] text-[13px] text-ink-muted">
                      {d.sapDocNumber ? (
                        <span className="tabular font-semibold text-ok">{d.sapDocNumber}</span>
                      ) : d.status === 'STAGED' ? (
                        'Menunggu hasil posting dari SAP'
                      ) : d.status === 'PROCESSING' ? (
                        'Worker sedang mengirim dokumen'
                      ) : d.nextAttemptAt ? (
                        `Dicoba lagi ${new Date(d.nextAttemptAt).toLocaleString('id-ID', {
                          timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit',
                        })}${d.lastError ? ` · ${d.lastError}` : ''}`
                      ) : (
                        (d.lastError ?? '—')
                      )}
                    </Td>
                  </Tr>
                ))
              )}
            </tbody>
          </Table>
        </Card>
      </Reveal>

      {meta.totalPages > 1 ? (
        <p className="mt-5 text-[14px] text-ink-muted">
          Halaman {meta.page} dari {meta.totalPages}
          {meta.page > 1 ? <Link href={href({ page: meta.page - 1 })} className="ml-4 font-semibold text-ink">Sebelumnya</Link> : null}
          {meta.page < meta.totalPages ? <Link href={href({ page: meta.page + 1 })} className="ml-4 font-semibold text-ink">Berikutnya</Link> : null}
        </p>
      ) : null}
    </>
  );
}

const TONE = {
  accent: 'text-accent',
  ok: 'text-ok',
  live: 'text-live',
  ng: 'text-ng',
  warn: 'text-warn',
  muted: 'text-ink-muted',
} as const;

function Kartu({
  icon: Icon,
  label,
  nilai,
  tone,
}: {
  icon: typeof Clock;
  label: string;
  nilai: number;
  tone: keyof typeof TONE;
}) {
  return (
    <div className="rounded-card border border-line bg-card p-4">
      <p className="flex items-center gap-2 text-[13px] font-semibold text-ink-muted">
        <Icon className={cn('size-4 shrink-0', TONE[tone])} strokeWidth={2} aria-hidden />
        {label}
      </p>
      <p className={cn('tabular mt-1 text-[30px] font-extrabold leading-none', TONE[tone])}>
        {nilai.toLocaleString('id-ID')}
      </p>
    </div>
  );
}
