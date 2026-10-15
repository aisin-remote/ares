import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Boxes, Package, Search } from 'lucide-react';
import { getMasterOptions, listStock } from '@/lib/queries';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { Card, CardHeader } from '@/components/ui/card';
import { Table, Th, Td, Tr, EmptyState } from '@/components/ui/table';
import { Reveal, Stagger, StaggerItem } from '@/components/motion/reveal';
import { waktu } from '@/components/picklist/status';
import { cn } from '@/components/ui/cn';
import { requirePermission } from '@/lib/session';
import { SelectSearch } from '@/components/ui/select-search';

export const dynamic = 'force-dynamic';

const PER_PAGE = 50;

/**
 * Stok WH per part (F-41): Σ receipt − Σ konsumsi ± penyesuaian.
 *
 * Saldonya tidak pernah disimpan sebagai kolom yang bisa diedit (aturan 7);
 * yang dibaca adalah snapshot harian — turunan dari TT_STOCK_MUTATION — plus
 * mutasi sejak snapshot itu.
 */
export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<{ vendor?: string; q?: string; page?: string }>;
}) {
  const user = await requirePermission('stock.read');
  if (user.plantId == null) notFound();
  const sp = await searchParams;
  const vendorId = Number(sp.vendor);
  const q = sp.q?.trim() || undefined;
  const page = Math.max(1, Math.floor(Number(sp.page ?? 1)) || 1);
  const [{ data: rows, meta }, vendorOptions] = await Promise.all([
    listStock({
      plantId: user.plantId,
      vendorId: Number.isInteger(vendorId) && vendorId > 0 ? vendorId : undefined,
      q,
      page,
      perPage: PER_PAGE,
    }),
    getMasterOptions('vendors'),
  ]);

  const tautanHalaman = (p: number) => {
    const query = new URLSearchParams();
    if (sp.vendor) query.set('vendor', sp.vendor);
    if (q) query.set('q', q);
    query.set('page', String(p));
    return `/stock?${query.toString()}`;
  };

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Logistik' }, { label: 'Stok WH' }]}
        title="Stok WH"
        description={`${meta.total} part punya mutasi · ${meta.pcs.toLocaleString('id-ID')} pcs di gudang komponen`}
        actions={
          <form action="/stock" className="flex flex-wrap items-center gap-2">
            <SelectSearch
              name="vendor"
              defaultValue={sp.vendor ?? ''}
              ariaLabel="Saring supplier"
              placeholder="Semua supplier"
              options={vendorOptions}
              pill
            />
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
          <StatCard label="Part bermutasi" value={meta.total} icon={Package} />
        </StaggerItem>
        <StaggerItem>
          <StatCard label="Total pcs" value={meta.pcs} hint="semua sloc" icon={Boxes} />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            label="Saldo negatif"
            value={meta.negatif}
            hint={meta.negatif > 0 ? 'periksa konsumsi / penyesuaian' : 'tidak ada'}
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

      {meta.totalPages > 1 ? (
        <div className="mt-5 flex items-center gap-4 text-[14px] text-ink-muted">
          <span>
            Halaman {meta.page} dari {meta.totalPages}
          </span>
          {meta.page > 1 ? (
            <Link href={tautanHalaman(meta.page - 1)} className="font-semibold text-ink hover:underline">
              Sebelumnya
            </Link>
          ) : null}
          {meta.page < meta.totalPages ? (
            <Link href={tautanHalaman(meta.page + 1)} className="font-semibold text-ink hover:underline">
              Berikutnya
            </Link>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
