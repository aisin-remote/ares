import { notFound } from 'next/navigation';
import { FileSpreadsheet } from 'lucide-react';
import { sapPoMonth } from '@ares/domain';
import { requirePermission } from '@/lib/session';
import { getPoOverview } from '@/lib/queries';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Table, Th, Td, Tr, EmptyState } from '@/components/ui/table';
import { waktu } from '@/components/picklist/status';

export const dynamic = 'force-dynamic';

const number = (value: number) => value.toLocaleString('id-ID');

/** Item PO satu supplier pada satu bulan berlaku (F-44) beserta sisanya (F-19). */
export default async function PoVendorPage({
  params,
  searchParams,
}: {
  params: Promise<{ vendorId: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  const user = await requirePermission('outbox.read');
  if (user.vendorId !== null) notFound();
  const vendorId = Number((await params).vendorId);
  if (!Number.isSafeInteger(vendorId) || vendorId <= 0) notFound();
  const query = await searchParams;
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(query.month ?? '') ? query.month! : sapPoMonth();
  const { suppliers, items } = await getPoOverview(month, vendorId);
  const supplier = suppliers[0];
  if (!supplier) notFound();
  const inputClass = 'h-11 rounded-2xl border border-line bg-surface px-3 text-[14px] text-ink outline-none focus:border-line-strong';

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'PO Supplier', href: `/po?month=${month}` }, { label: supplier.name }]}
        title={supplier.name}
        description={`Vendor ${supplier.sapVendorNo ?? '—'} · PO berlaku ${month}`}
      />

      <Card className="mb-5">
        <CardBody>
          <form action={`/po/${vendorId}`} method="get" className="flex flex-wrap items-end gap-4">
            <label className="grid gap-2 text-[12px] font-semibold text-ink-muted">Bulan berlaku PO
              <input type="month" name="month" defaultValue={month} required className={inputClass} />
            </label>
            <button className="h-11 rounded-full bg-accent px-5 text-sm font-semibold text-white">Tampilkan</button>
          </form>
        </CardBody>
      </Card>

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4 a-rise">
        {[
          { label: 'Nomor PO', value: supplier.poNos.join(', ') || '—', hint: `${supplier.itemCount} item` },
          { label: 'Qty PO', value: number(supplier.openQty), hint: supplier.syncedAt ? `Tarik terakhir ${waktu(supplier.syncedAt)}` : 'Belum pernah ditarik' },
          { label: 'Sudah dipesan', value: number(supplier.orderedPcs), hint: 'Order Sheet yang tidak dibatalkan' },
          { label: 'Sisa', value: number(supplier.remainingPcs), hint: 'Masih bisa dipesan bulan ini' },
        ].map((metric) => (
          <Card key={metric.label} className="p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{metric.label}</p>
            <p className="mt-3 break-words text-[26px] font-extrabold tabular-nums tracking-tight">{metric.value}</p>
            <p className="mt-2 text-xs leading-5 text-ink-muted">{metric.hint}</p>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader icon={FileSpreadsheet} title="Item PO" subtitle={`${items.length} item berlaku ${month}`} />
        <Table scroll>
          <thead><tr>
            <Th sticky="left">PO / item</Th><Th>Part</Th><Th align="right">Qty PO</Th>
            <Th align="right">Sudah dipesan</Th><Th align="right">Sisa</Th><Th>Keterangan</Th>
          </tr></thead>
          <tbody>
            {items.length ? items.map((row) => (
              <Tr key={`${row.sapPoNo}-${row.item}`}>
                <Td sticky="left" strong className="whitespace-nowrap font-mono text-[13px]">{row.sapPoNo} / {row.item}</Td>
                <Td><span className="block font-semibold">{row.partNo}</span><span className="text-xs text-ink-muted">{row.partName}</span></Td>
                <Td align="right" className="whitespace-nowrap tabular-nums">{number(row.openQty)} {row.uom}</Td>
                <Td align="right" className="tabular-nums">{number(row.orderedPcs)}</Td>
                <Td align="right" className={`tabular-nums font-semibold ${row.remainingPcs === 0 ? 'text-ng' : ''}`}>{number(row.remainingPcs)}</Td>
                <Td className="whitespace-nowrap text-xs text-ink-muted">
                  {!row.isActive ? 'PO/item ditutup di SAP' : row.remainingPcs === 0 ? 'Habis' : row.source === 'SAP' ? 'Dari SAP' : 'Input lokal'}
                </Td>
              </Tr>
            )) : <EmptyState colSpan={6}>Supplier ini belum punya PO yang berlaku untuk {month}.</EmptyState>}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
