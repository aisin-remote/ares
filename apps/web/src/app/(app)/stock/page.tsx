import Link from 'next/link';
import { Boxes, Package, Search } from 'lucide-react';
import { getMasterOptions, listStock } from '@/lib/queries';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { Card, CardHeader } from '@/components/ui/card';
import { Table, Th, Td, Tr, EmptyState } from '@/components/ui/table';
import { Reveal, Stagger, StaggerItem } from '@/components/motion/reveal';
import { waktu } from '@/components/picklist/status';
import { cn } from '@/components/ui/cn';

export const dynamic = 'force-dynamic';

/**
 * Stok WH per part (F-41): Σ receipt − Σ konsumsi ± penyesuaian, dihitung
 * dari TT_STOCK_MUTATION saat dibaca — tidak ada tabel saldo.
 */
export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<{ vendor?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const vendorId = Number(sp.vendor);
  const q = sp.q?.trim() || undefined;
  const [rows, vendorOptions] = await Promise.all([
    listStock({ vendorId: Number.isInteger(vendorId) && vendorId > 0 ? vendorId : undefined, q }),
    getMasterOptions('vendors'),
  ]);

  const totalPcs = rows.reduce((n, r) => n + r.pcs, 0);
  const negatif = rows.filter((r) => r.pcs < 0).length;

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Logistik' }, { label: 'Stok WH' }]}
        title="Stok WH"
        description={`${rows.length} part punya mutasi · ${totalPcs.toLocaleString('id-ID')} pcs di gudang komponen`}
        actions={
          <form action="/stock" className="flex flex-wrap items-center gap-2">
            <select
              name="vendor"
              defaultValue={sp.vendor ?? ''}
              aria-label="Saring supplier"
              className="h-11 rounded-full border border-line bg-card px-4 text-[14px] outline-none transition-colors focus:border-line-strong"
            >
              <option value="">Semua supplier</option>
              {vendorOptions.map((v) => (
                <option key={v.value} value={v.value}>
                  {v.label}
                </option>
              ))}
            </select>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-ink-muted"
                strokeWidth={1.8}
                aria-hidden
              />
              <input
                type="search"
                name="q"
                defaultValue={q ?? ''}
                placeholder="Cari part"
                aria-label="Cari part"
                className="h-11 w-56 rounded-full border border-line bg-card pl-11 pr-4 text-[14px] outline-none transition-colors placeholder:text-ink-muted focus:border-line-strong"
              />
            </div>
            <button
              type="submit"
              className="h-11 rounded-full bg-accent px-5 text-[14px] font-semibold text-white transition-colors hover:bg-accent-soft"
            >
              Saring
            </button>
          </form>
        }
      />

      <Stagger className="mb-5 grid gap-5 sm:grid-cols-3">
        <StaggerItem>
          <StatCard label="Part bermutasi" value={rows.length} icon={Package} />
        </StaggerItem>
        <StaggerItem>
          <StatCard label="Total pcs" value={totalPcs} hint="semua sloc" icon={Boxes} />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            label="Saldo negatif"
            value={negatif}
            hint={negatif > 0 ? 'periksa konsumsi / penyesuaian' : 'tidak ada'}
            icon={Boxes}
          />
        </StaggerItem>
      </Stagger>

      <Reveal>
        <Card>
          <CardHeader
            icon={Boxes}
            title="Saldo per part"
            subtitle="Ekuivalen box memakai qty/box vendor part aktif; klik part untuk buku mutasinya"
          />
          <Table>
            <thead>
              <tr>
                <Th>Part</Th>
                <Th>Supplier</Th>
                <Th align="right">Pcs</Th>
                <Th align="right">Qty/box</Th>
                <Th align="right">≈ Box</Th>
                <Th>Mutasi terakhir</Th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <EmptyState colSpan={6}>
                  Belum ada mutasi stok pada saringan ini. Stok bertambah saat sesi scan ditutup
                  (receipt) dan berkurang saat konsumsi produksi masuk.
                </EmptyState>
              ) : (
                rows.map((r) => (
                  <Tr key={r.partId}>
                    <Td strong className="whitespace-nowrap">
                      <Link href={`/stock/${r.partId}`} className="tabular hover:underline">
                        {r.partNo}
                      </Link>
                      <span className="ml-2 font-normal text-ink-muted">{r.partName}</span>
                    </Td>
                    <Td>{r.vendors ?? <span className="text-ink-muted">—</span>}</Td>
                    <Td
                      align="right"
                      className={cn('tabular font-bold', r.pcs < 0 ? 'text-ng' : 'text-ink')}
                    >
                      {r.pcs.toLocaleString('id-ID')}
                    </Td>
                    <Td align="right" className="tabular">
                      {r.qtyPerBox ?? '—'}
                    </Td>
                    <Td align="right" className="tabular">
                      {r.boxes === null ? '—' : r.boxes.toLocaleString('id-ID')}
                    </Td>
                    <Td className="tabular whitespace-nowrap">
                      <Link href={`/stock/${r.partId}`} className="hover:underline">
                        {r.lastAt ? waktu(r.lastAt) : '—'}
                        <span className="ml-1 text-ink-muted">· {r.mutations} mutasi</span>
                      </Link>
                    </Td>
                  </Tr>
                ))
              )}
            </tbody>
          </Table>
        </Card>
      </Reveal>
    </>
  );
}
