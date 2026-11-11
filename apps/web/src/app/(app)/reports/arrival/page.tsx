import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BarChart3, ClipboardList, Download, Info } from 'lucide-react';
import { performancePeriod } from '@ares/domain';
import { requirePermission } from '@/lib/session';
import { getPerformanceSuppliers, getSupplierPerformance } from '@/lib/supplier-performance';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Table, Th, Td, Tr, EmptyState } from '@/components/ui/table';
import { SelectSearch } from '@/components/ui/select-search';
import { waktu } from '@/components/picklist/status';

export const dynamic = 'force-dynamic';
const LABEL: Record<string, string> = { ALL: 'Semua kedatangan', ON_TIME: 'Tepat waktu', LATE: 'Terlambat',
  NOT_ARRIVED: 'Belum tiba', UNKNOWN: 'Data belum cukup', UPCOMING: 'Belum jatuh tempo' };
const TONE: Record<string, string> = { ON_TIME: 'border-ok/40 bg-ok/10 text-ok', LATE: 'border-ng/40 bg-ng/10 text-ng',
  NOT_ARRIVED: 'border-warn/40 bg-warn/10 text-warn', UNKNOWN: 'border-line text-ink-muted', UPCOMING: 'border-live/40 bg-live/10 text-live' };
const number = (value: number) => value.toLocaleString('id-ID', { maximumFractionDigits: 1 });
const percent = (value: number | null) => value === null ? '—' : `${number(value)}%`;
const duration = (minutes: number | null) => minutes === null ? '—' : minutes < 60 ? `${number(minutes)} menit` : `${number(minutes / 60)} jam`;
type Params = { from?: string; to?: string; vendor?: string; tolerance?: string; status?: string; page?: string };

export default async function SupplierPerformancePage({ searchParams }: { searchParams: Promise<Params> }) {
  const user = await requirePermission('report.arrival.read');
  if (user.plantId === null || user.vendorId !== null) notFound();
  const params = await searchParams;
  const now = new Date();
  const supplierOptions = await getPerformanceSuppliers(user.plantId);
  let period: ReturnType<typeof performancePeriod>;
  let report: Awaited<ReturnType<typeof getSupplierPerformance>> | null = null;
  let error: string | null = null;
  let vendorId: number | undefined;
  try {
    period = performancePeriod(params, now);
    if (params.vendor && (!/^\d+$/.test(params.vendor) || !Number.isSafeInteger(Number(params.vendor)) || Number(params.vendor) < 1))
      throw new Error('Pilih supplier yang valid.');
    vendorId = params.vendor ? Number(params.vendor) : undefined;
    report = await getSupplierPerformance(user.plantId, { ...period, vendorId });
  } catch (err) {
    // Pesan query database tetap di log server; hanya kesalahan filter yang ditampilkan.
    const message = err instanceof Error ? err.message : '';
    error = /^(Isi periode|Maksimal|Toleransi|Lebih dari|Pilih supplier)/.test(message)
      ? message : 'Laporan belum bisa dimuat. Coba lagi beberapa saat lagi.';
    if (error !== message) console.error('[laporan performa supplier]', err);
    period = performancePeriod({}, now);
  }
  const href = (overrides: Partial<Params> = {}, path = '/reports/arrival') => {
    const values = { ...params, from: period.from, to: period.to, tolerance: String(period.toleranceMinutes), ...overrides };
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(values)) if (value) query.set(key, value);
    return `${path}?${query}`;
  };
  const status = params.status && LABEL[params.status] ? params.status : 'ALL';
  const details = report?.orders.filter((order) => status === 'ALL' || order.arrival === status) ?? [];
  const pages = Math.max(1, Math.ceil(details.length / 25));
  const page = Math.min(pages, Math.max(1, Math.floor(Number(params.page)) || 1));
  const visibleOrders = details.slice((page - 1) * 25, page * 25);
  const total = report?.total;
  const inputClass = 'h-11 rounded-2xl border border-line bg-surface px-3 text-[14px] text-ink outline-none focus:border-line-strong';

  return (
    <>
      <PageHeader crumbs={[{ label: 'Performa supplier' }]} title="Performa supplier"
        description="Ketepatan kedatangan, kelengkapan penerimaan, dan waktu konfirmasi per supplier"
        actions={report && report.total.orders > 0 ? <Link href={href({ page: undefined, status: undefined }, '/reports/arrival/csv')}
          className="inline-flex h-11 items-center gap-2 rounded-full border border-line px-5 text-sm font-semibold hover:border-ink"><Download className="size-4" aria-hidden />Unduh CSV</Link> : undefined} />

      <Card className="mb-5">
        <CardBody>
          <form action="/reports/arrival" method="get" className="grid items-end gap-4 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_2fr_1fr_auto]">
            <label className="grid gap-2 text-[12px] font-semibold text-ink-muted">Dari jadwal kirim
              <input type="date" name="from" defaultValue={period.from} required className={inputClass} />
            </label>
            <label className="grid gap-2 text-[12px] font-semibold text-ink-muted">Sampai jadwal kirim
              <input type="date" name="to" defaultValue={period.to} required className={inputClass} />
            </label>
            <div className="grid gap-2 text-[12px] font-semibold text-ink-muted">
              <label htmlFor="performance-supplier">Supplier</label>
              <SelectSearch id="performance-supplier" name="vendor" ariaLabel="Supplier" key={params.vendor ?? 'all'} defaultValue={params.vendor ?? ''}
                options={[{ value: '', label: 'Semua supplier' }, ...supplierOptions.map((supplier) => ({ value: supplier.id, label: `${supplier.name} · ${supplier.code ?? '—'}` }))]} />
            </div>
            <label className="grid gap-2 text-[12px] font-semibold text-ink-muted">Toleransi (menit)
              <input type="number" name="tolerance" min="0" max="120" step="1" defaultValue={period.toleranceMinutes} required className={inputClass} />
            </label>
            <button className="h-11 rounded-full bg-accent px-5 text-sm font-semibold text-white">Tampilkan</button>
          </form>
          <p className="mt-3 text-xs text-ink-muted">Maksimal 93 hari. Cakupan mengikuti pabrik akun Anda. Penilaian sampai {waktu(period.asOf)} WIB.</p>
        </CardBody>
      </Card>

      {error ? <Card className="border-ng/40 p-5"><p role="alert" className="text-sm text-ng">{error}</p></Card> : null}
      {total && report ? <>
        <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4 a-rise">
          {[
            { label: 'Order jatuh tempo', value: number(total.dueOrders), hint: `${total.upcoming} belum jatuh tempo · ${report.suppliers.length} supplier` },
            { label: 'Tepat waktu', value: percent(total.onTimePercent), hint: `${total.onTime} dari ${total.arrivalSample} order yang dapat dinilai` },
            { label: 'Kelengkapan diterima', value: percent(total.fulfillmentPercent), hint: `${number(total.fulfilledPcs)} dari ${number(total.orderedPcs)} pcs kebutuhan` },
            { label: 'Rata-rata konfirmasi', value: duration(total.averageConfirmationMinutes), hint: `Dari ${total.confirmationSample} konfirmasi dengan waktu valid` },
          ].map((metric) => <Card key={metric.label} className="p-5"><p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{metric.label}</p>
            <p className="mt-3 text-[30px] font-extrabold tabular-nums tracking-tight">{metric.value}</p><p className="mt-2 text-xs leading-5 text-ink-muted">{metric.hint}</p></Card>)}
        </div>

        <div className="mb-5 flex flex-wrap gap-x-5 gap-y-2 rounded-2xl border border-line bg-card px-5 py-3 text-[13px] text-ink-soft">
          <span>{total.late} terlambat</span><span>{total.notArrived} belum tiba</span><span>{total.unknownArrival} data kedatangan belum cukup</span>
          <span>{total.withoutConfirmation} tanpa konfirmasi tercatat</span><span>{total.invalidConfirmation} waktu konfirmasi tidak konsisten</span><span>{total.autoShipped} receiving tanpa konfirmasi supplier</span>
        </div>

        <Card className="mb-5">
          <CardHeader icon={BarChart3} title="Perbandingan supplier" subtitle="Order asal dihitung sekali; penerimaan recovery ikut ke order asal" />
          <Table scroll><thead><tr><Th sticky="left">Supplier</Th><Th align="right">Jatuh tempo</Th><Th>Tepat waktu</Th><Th>Kelengkapan</Th><Th>Konfirmasi</Th><Th align="right">Belum tiba</Th><Th sticky="right">Aksi</Th></tr></thead>
            <tbody>{report.suppliers.length ? report.suppliers.map((supplier) => <Tr key={supplier.vendorId}>
              <Td sticky="left" strong><span className="block min-w-40">{supplier.vendorName}</span><span className="text-xs font-normal text-ink-muted">{supplier.vendorCode}</span></Td>
              <Td align="right">{supplier.dueOrders}</Td>
              <Td><strong className="block tabular-nums">{percent(supplier.onTimePercent)}</strong><span className="text-xs text-ink-muted">{supplier.onTime}/{supplier.arrivalSample} dinilai</span></Td>
              <Td><strong className="block tabular-nums">{percent(supplier.fulfillmentPercent)}</strong><span className="text-xs text-ink-muted">{number(supplier.shortPcs)} pcs belum diterima</span></Td>
              <Td><span className="block whitespace-nowrap">{duration(supplier.averageConfirmationMinutes)}</span><span className="text-xs text-ink-muted">{supplier.confirmationSample} sampel valid</span></Td>
              <Td align="right">{supplier.notArrived}</Td>
              <Td sticky="right"><Link href={href({ vendor: String(supplier.vendorId), page: undefined, status: undefined })} className="whitespace-nowrap font-semibold hover:underline">Lihat order</Link></Td>
            </Tr>) : <EmptyState colSpan={7}>Tidak ada order asal pada periode ini. Ubah periode atau supplier untuk melihat laporan.</EmptyState>}</tbody>
          </Table>
        </Card>

        <Card className="mb-5">
          <CardHeader icon={ClipboardList} title="Rincian order asal" subtitle={`${details.length} order · penerimaan dihitung dari sesi yang sudah ditutup`} />
          <div className="flex flex-wrap gap-2 border-t border-line px-5 py-3">{Object.entries(LABEL).map(([value, label]) => <Link key={value}
            href={href({ status: value, page: undefined })} className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${status === value ? 'border-ink text-ink' : 'border-line text-ink-muted hover:border-ink'}`}>{label}</Link>)}</div>
          <Table scroll><thead><tr><Th sticky="left">Order / supplier</Th><Th>Jadwal WIB</Th><Th>Scan pertama WIB</Th><Th>Kedatangan</Th><Th align="right">Pcs diterima / dipesan</Th><Th>Waktu konfirmasi</Th></tr></thead>
            <tbody>{visibleOrders.length ? visibleOrders.map((order) => <Tr key={order.id}>
              <Td sticky="left" strong><Link href={`/picklist/${order.publicId}`} className="hover:underline">{order.orderNo}</Link><span className="mt-1 block text-xs font-normal text-ink-muted">{order.vendorName}</span></Td>
              <Td className="whitespace-nowrap">{waktu(order.scheduledAt)}</Td><Td className="whitespace-nowrap">{order.firstScanAt ? waktu(order.firstScanAt) : '—'}</Td>
              <Td><span className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold ${TONE[order.arrival]}`}>{LABEL[order.arrival]}</span></Td>
              <Td align="right" className="whitespace-nowrap">{order.dueOrders ? `${number(order.receivedPcs)} / ${number(order.orderedPcs)}` : 'Belum dinilai'}{order.extraPcs > 0 ? <span className="block text-xs text-warn">Lebih {number(order.extraPcs)} pcs</span> : null}</Td>
              <Td className="whitespace-nowrap">{order.confirmedAt && order.confirmedAt <= period.asOf ? duration(order.confirmationMinutes) : 'Belum tercatat'}</Td>
            </Tr>) : <EmptyState colSpan={6}>Tidak ada order dengan status kedatangan yang dipilih.</EmptyState>}</tbody>
          </Table>
          {pages > 1 ? <div className="flex flex-wrap items-center gap-4 px-5 py-4 text-sm text-ink-muted"><span>Halaman {page} dari {pages}</span>
            {page > 1 ? <Link href={href({ page: String(page - 1) })} className="font-semibold text-ink">Sebelumnya</Link> : null}
            {page < pages ? <Link href={href({ page: String(page + 1) })} className="font-semibold text-ink">Berikutnya</Link> : null}</div> : null}
        </Card>

        <Card><CardHeader icon={Info} title="Cara membaca laporan" subtitle="Definisi metrik yang dipakai pada halaman ini" />
          <CardBody className="space-y-3 border-t border-line text-[13px] leading-6 text-ink-muted">
            <p><strong className="text-ink">Kedatangan:</strong> scan kanban pertama dari sesi receiving yang tidak dibatalkan, dibanding jadwal order asal + {period.toleranceMinutes} menit. Diukur dari proses receiving, bukan jam truk masuk.</p>
            <p><strong className="text-ink">Tepat waktu:</strong> order yang tiba tepat waktu dibanding seluruh order yang sudah jatuh tempo. Order yang belum tiba tetap dihitung; order mendatang dan yang dibatalkan tidak dinilai.</p>
            <p><strong className="text-ink">Kelengkapan:</strong> pcs yang diterima sampai batas penilaian, termasuk recovery, dibanding kebutuhan order asal per part. Kelebihan satu part tidak menutup kekurangan part lain; box pada sesi yang masih terbuka belum dihitung.</p>
            <p><strong className="text-ink">Konfirmasi:</strong> rata-rata waktu dari order terbit sampai supplier konfirmasi kirim. Konfirmasi otomatis dari receiving tidak ikut dihitung.</p>
          </CardBody>
        </Card>
      </> : null}
    </>
  );
}
