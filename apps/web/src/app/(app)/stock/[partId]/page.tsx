import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Boxes, Building2, History, Package, SlidersHorizontal } from 'lucide-react';
import { getStockLedger } from '@/lib/queries';
import { getSessionUser } from '@/lib/session';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { Card, CardHeader, CardDivider } from '@/components/ui/card';
import { InfoRow, InfoRowPair } from '@/components/ui/info-row';
import { Table, Th, Td, Tr, EmptyState } from '@/components/ui/table';
import { Reveal, Stagger, StaggerItem } from '@/components/motion/reveal';
import { AdjustStockForm } from '@/components/stock/adjust-stock-form';
import { waktu } from '@/components/picklist/status';
import { cn } from '@/components/ui/cn';

export const dynamic = 'force-dynamic';

const TYPE_LABEL: Record<string, string> = {
  RECEIPT: 'Penerimaan',
  CONSUMPTION: 'Konsumsi',
  ADJUST: 'Penyesuaian',
};

/** Buku mutasi satu part (F-41) + penyesuaian manual (F-42). */
export default async function StockLedgerPage({ params }: { params: Promise<{ partId: string }> }) {
  const { partId } = await params;
  const id = Number(partId);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const [ledger, user] = await Promise.all([getStockLedger(id), getSessionUser()]);
  if (!ledger) notFound();
  // Tombolnya hanya untuk PPIC/Admin; haknya (`stock.adjust`) tetap diperiksa server.
  const bisaSesuaikan = user?.role === 'ppic' || user?.role === 'admin';

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Stok WH', href: '/stock' }, { label: ledger.part.partNo }]}
        title={ledger.part.partNo}
        description={ledger.part.name}
      />

      <Stagger className="mb-5 grid gap-5 sm:grid-cols-3">
        <StaggerItem>
          <StatCard label={`Saldo (${ledger.part.uom})`} value={ledger.pcs} icon={Boxes} />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            label="Ekuivalen box"
            value={Math.floor(ledger.boxes ?? 0)}
            hint={
              ledger.qtyPerBox
                ? `${ledger.qtyPerBox} ${ledger.part.uom}/box`
                : 'belum ada vendor part'
            }
            icon={Package}
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard label="Mutasi tercatat" value={ledger.mutations.length} icon={History} />
        </StaggerItem>
      </Stagger>

      <Reveal>
        <Card>
          <CardHeader
            icon={Building2}
            title="Supplier & kemasan"
            subtitle="Qty/box dari vendor part aktif; ekuivalen box memakai yang terkecil"
          />
          <CardDivider />
          {ledger.vendorParts.length === 0 ? (
            <p className="px-6 py-5 text-[14px] text-ink-muted">
              Part ini belum punya vendor part aktif.
            </p>
          ) : (
            <InfoRowPair>
              {ledger.vendorParts.map((v) => (
                <InfoRow key={`${v.vendorName}-${v.backNo}`} icon={Building2} label={v.vendorName}>
                  {v.qtyPerBox} {ledger.part.uom}/box · back no {v.backNo}
                </InfoRow>
              ))}
            </InfoRowPair>
          )}
        </Card>
      </Reveal>

      {bisaSesuaikan ? (
        <Reveal delayMs={60} className="mt-5">
          <Card>
            <CardHeader
              icon={SlidersHorizontal}
              title="Penyesuaian manual"
              subtitle="Koreksi = baris mutasi baru beralasan; saldo tidak pernah ditimpa (F-42)"
            />
            <CardDivider />
            <AdjustStockForm partId={ledger.part.id} uom={ledger.part.uom} />
          </Card>
        </Reveal>
      ) : null}

      <Reveal delayMs={120} className="mt-5">
        <Card>
          <CardHeader
            icon={History}
            title="Buku mutasi"
            subtitle="Terbaru di atas; 100 baris terakhir"
          />
          <Table>
            <thead>
              <tr>
                <Th>Waktu</Th>
                <Th>Jenis</Th>
                <Th align="right">Selisih</Th>
                <Th>Sloc</Th>
                <Th>Rujukan / alasan</Th>
                <Th>Oleh</Th>
              </tr>
            </thead>
            <tbody>
              {ledger.mutations.length === 0 ? (
                <EmptyState colSpan={6}>Belum ada mutasi untuk part ini.</EmptyState>
              ) : (
                ledger.mutations.map((m) => (
                  <Tr key={m.id}>
                    <Td className="tabular whitespace-nowrap">{waktu(m.occurredAt)}</Td>
                    <Td>{TYPE_LABEL[m.type] ?? m.type}</Td>
                    <Td
                      align="right"
                      className={cn('tabular font-bold', m.deltaPcs < 0 ? 'text-ng' : 'text-ok')}
                    >
                      {m.deltaPcs > 0 ? '+' : ''}
                      {m.deltaPcs.toLocaleString('id-ID')}
                    </Td>
                    <Td className="tabular">{m.sloc}</Td>
                    <Td>
                      {m.receiptId ? (
                        <Link
                          href={`/receiving/${m.receiptId}/ringkasan`}
                          className="tabular hover:underline"
                        >
                          {m.receiptNo}
                        </Link>
                      ) : (
                        (m.note ?? <span className="text-ink-muted">—</span>)
                      )}
                    </Td>
                    <Td>{m.userName ?? <span className="text-ink-muted">sistem</span>}</Td>
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
