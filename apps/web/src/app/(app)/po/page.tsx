import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Building2 } from 'lucide-react';
import { sapPoMonth } from '@ares/domain';
import { requirePermission } from '@/lib/session';
import { getPoOverview } from '@/lib/queries';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Table, Th, Td, Tr, EmptyState } from '@/components/ui/table';
import { ClickableRow } from '@/components/ui/clickable-row';
import { waktu } from '@/components/picklist/status';

export const dynamic = 'force-dynamic';

const number = (value: number) => value.toLocaleString('id-ID');
const STATUS: Record<string, string> = { ALL: 'Semua supplier', READY: 'Sudah ada PO', MISSING: 'Belum ada PO' };
type Params = { month?: string; status?: string };

/**
 * Daftar PO per bulan berlaku (F-44): supplier mana yang PO-nya sudah terbit.
 * Rincian item dan sisanya (F-19) ada di /po/[vendorId].
 */
export default async function PoOverviewPage({ searchParams }: { searchParams: Promise<Params> }) {
  const user = await requirePermission('outbox.read');
  if (user.vendorId !== null) notFound();
  const params = await searchParams;
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(params.month ?? '') ? params.month! : sapPoMonth();
  const status = params.status && STATUS[params.status] ? params.status : 'ALL';
  const { suppliers, items } = await getPoOverview(month);

  const ready = suppliers.filter((s) => s.itemCount > 0);
  // Yang sudah punya PO di atas; urutan nama dari query tetap terjaga (sort stabil).
  const shown = suppliers
    .filter((s) => status === 'ALL' || (status === 'READY') === s.itemCount > 0)
    .sort((a, b) => Number(b.itemCount > 0) - Number(a.itemCount > 0));
  const href = (overrides: Partial<Params>) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...params, month, ...overrides })) if (value) query.set(key, value);
    return `/po?${query}`;
  };
  const inputClass = 'h-11 rounded-2xl border border-line bg-surface px-3 text-[14px] text-ink outline-none focus:border-line-strong';

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'PO Supplier' }]}
        title="PO Supplier"
        description="Supplier yang sudah punya PO pada bulan berlaku, beserta qty dan sisa yang masih bisa dipesan"
      />

      <Card className="mb-5">
        <CardBody>
          <form action="/po" method="get" className="flex flex-wrap items-end gap-4">
            <label className="grid gap-2 text-[12px] font-semibold text-ink-muted">Bulan berlaku PO
              <input type="month" name="month" defaultValue={month} required className={inputClass} />
            </label>
            {status !== 'ALL' ? <input type="hidden" name="status" value={status} /> : null}
            <button className="h-11 rounded-full bg-accent px-5 text-sm font-semibold text-white">Tampilkan</button>
          </form>
          <p className="mt-3 text-xs text-ink-muted">
            PO yang dibuat SAP di satu bulan berlaku untuk order bulan berikutnya, dan Order Sheet memakai PO bulan tanggal kirimnya.
            Sisa = qty PO − pesanan ARES yang tidak dibatalkan. Tarik PO diatur di <Link href="/sap" className="font-semibold text-ink hover:underline">Integrasi SAP</Link>.
          </p>
        </CardBody>
      </Card>

      <div className="mb-5 grid gap-4 sm:grid-cols-3 a-rise">
        {[
          { label: 'Supplier aktif', value: number(suppliers.length), hint: `Bulan berlaku ${month}` },
          { label: 'Sudah ada PO', value: number(ready.length), hint: `${number(items.length)} item PO` },
          { label: 'Belum ada PO', value: number(suppliers.length - ready.length), hint: 'Belum bisa diorder untuk kirim bulan ini' },
        ].map((metric) => (
          <Card key={metric.label} className="p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{metric.label}</p>
            <p className="mt-3 text-[30px] font-extrabold tabular-nums tracking-tight">{metric.value}</p>
            <p className="mt-2 text-xs leading-5 text-ink-muted">{metric.hint}</p>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader icon={Building2} title="Status PO per supplier" subtitle={`${shown.length} supplier ditampilkan · klik baris untuk melihat item PO`} />
        <div className="flex flex-wrap gap-2 border-t border-line px-5 py-3">
          {Object.entries(STATUS).map(([value, label]) => (
            <Link key={value} href={href({ status: value === 'ALL' ? undefined : value })}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${status === value ? 'border-ink text-ink' : 'border-line text-ink-muted hover:border-ink'}`}>{label}</Link>
          ))}
        </div>
        <Table scroll>
          <thead><tr>
            <Th sticky="left">Supplier</Th><Th>Status</Th><Th>Nomor PO</Th><Th align="right">Item</Th>
            <Th align="right">Qty PO</Th><Th align="right">Sudah dipesan</Th><Th align="right">Sisa</Th><Th>Tarik terakhir</Th>
          </tr></thead>
          <tbody>
            {shown.length ? shown.map((s) => {
              const cells = <>
                <Td sticky="left" strong>
                  {s.itemCount
                    ? <Link href={`/po/${s.id}?month=${month}`} className="block min-w-40 hover:underline">{s.name}</Link>
                    : <span className="block min-w-40">{s.name}</span>}
                  <span className="text-xs font-normal text-ink-muted">{s.sapVendorNo ?? '—'}</span>
                </Td>
                <Td>
                  <span className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold ${s.itemCount ? 'border-ok/40 bg-ok/10 text-ok' : 'border-warn/40 bg-warn/10 text-warn'}`}>
                    {s.itemCount ? 'Sudah ada PO' : 'Belum ada PO'}
                  </span>
                </Td>
                <Td className="font-mono text-[13px]">{s.poNos.length ? s.poNos.join(', ') : '—'}</Td>
                <Td align="right">{s.itemCount || '—'}</Td>
                <Td align="right" className="tabular-nums">{s.itemCount ? number(s.openQty) : '—'}</Td>
                <Td align="right" className="tabular-nums">{s.itemCount ? number(s.orderedPcs) : '—'}</Td>
                <Td align="right" className="tabular-nums font-semibold">{s.itemCount ? number(s.remainingPcs) : '—'}</Td>
                <Td className="whitespace-nowrap">{s.syncedAt ? waktu(s.syncedAt) : '—'}</Td>
              </>;
              return s.itemCount
                ? <ClickableRow key={s.id} href={`/po/${s.id}?month=${month}`}>{cells}</ClickableRow>
                : <Tr key={s.id}>{cells}</Tr>;
            }) : <EmptyState colSpan={8}>Tidak ada supplier untuk filter ini.</EmptyState>}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
