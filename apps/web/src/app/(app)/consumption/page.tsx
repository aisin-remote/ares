import { AlertTriangle, Factory, Search } from 'lucide-react';
import { listConsumptionFailures, listConsumptions } from '@/lib/queries';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { Table, Td, Th, Tr, EmptyState } from '@/components/ui/table';
import { Reveal } from '@/components/motion/reveal';
import { ReverseConsumption } from '@/components/queue/reverse-consumption';
import { requirePermission } from '@/lib/session';

export const dynamic = 'force-dynamic';

const waktu = (value: Date) => value.toLocaleString('id-ID', {
  timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

export default async function ConsumptionPage({ searchParams }: {
  searchParams: Promise<{ q?: string; line?: string; from?: string; to?: string }>;
}) {
  await requirePermission('mes.read');
  const sp = await searchParams;
  const opts = {
    q: sp.q?.trim() || undefined,
    line: sp.line?.trim() || undefined,
    from: sp.from || undefined,
    to: sp.to || undefined,
  };
  const [rows, failures] = await Promise.all([listConsumptions(opts), listConsumptionFailures(opts)]);
  return <>
    <PageHeader
      crumbs={[{ label: 'Logistik' }, { label: 'Konsumsi' }]}
      title="Konsumsi produksi"
      description={`${rows.length} konsumsi komponen · ${failures.length} record perlu diperbaiki`}
      actions={<form action="/consumption" className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" aria-hidden />
          <input name="q" defaultValue={sp.q ?? ''} placeholder="Part atau error" className="h-10 w-44 rounded-full border border-line bg-card pl-9 pr-3 text-sm outline-none focus:border-line-strong" />
        </div>
        <input name="line" defaultValue={sp.line ?? ''} placeholder="Line" className="h-10 w-24 rounded-full border border-line bg-card px-3 text-sm outline-none focus:border-line-strong" />
        <input type="date" name="from" defaultValue={sp.from ?? ''} aria-label="Dari tanggal" className="h-10 rounded-full border border-line bg-card px-3 text-sm" />
        <input type="date" name="to" defaultValue={sp.to ?? ''} aria-label="Sampai tanggal" className="h-10 rounded-full border border-line bg-card px-3 text-sm" />
        <button className="h-10 rounded-full bg-accent px-4 text-sm font-semibold text-white">Saring</button>
      </form>}
    />

    {failures.length > 0 ? <Reveal><Card className="mb-5 border-ng/30">
      <CardHeader icon={AlertTriangle} title="Konsumsi gagal" subtitle="Perbaiki BOM, vendor part, atau cutoff; cursor MES akan mencoba record ini lagi." />
      <Table><thead><tr><Th>Record</Th><Th>Part jadi</Th><Th>Line</Th><Th align="right">Qty</Th><Th>Waktu produksi</Th><Th>Masalah</Th></tr></thead>
        <tbody>{failures.map((row) => <Tr key={row.id}>
          <Td strong className="tabular">{row.recordId}</Td><Td>{row.partNo}</Td><Td>{row.line}</Td>
          <Td align="right" className="tabular">{row.qty.toLocaleString('id-ID')}</Td><Td className="whitespace-nowrap">{waktu(row.occurredAt)}</Td><Td className="text-ng">{row.error}</Td>
        </Tr>)}</tbody>
      </Table>
    </Card></Reveal> : null}

    <Reveal><Card>
      <CardHeader icon={Factory} title="Riwayat konsumsi" subtitle="Maksimal 200 baris terbaru; satu hasil produksi dapat menjadi beberapa komponen BOM." />
      <Table><thead><tr><Th>Sumber</Th><Th>Part jadi</Th><Th>Komponen</Th><Th>Supplier</Th><Th align="right">Qty</Th><Th>Line</Th><Th>Produksi</Th><Th>Status</Th><Th>Aksi</Th></tr></thead>
        <tbody>{rows.length === 0 ? <EmptyState colSpan={9}>Belum ada konsumsi pada saringan ini. Tarik data dari layar Sinkron MES.</EmptyState> : rows.map((row) => <Tr key={row.id}>
          <Td className="tabular">{row.sourceKey}</Td><Td>{row.parentPartNo}</Td><Td strong>{row.componentPartNo}<span className="ml-2 font-normal text-ink-muted">{row.componentName}</span></Td>
          <Td>{row.vendorName}</Td><Td align="right" className="tabular font-semibold">{row.qty.toLocaleString('id-ID')}</Td><Td>{row.line}</Td><Td className="whitespace-nowrap">{waktu(row.occurredAt)}</Td>
          <Td>{row.reversedAt ? <span className="font-semibold text-ng">Dibatalkan</span> : Number(row.closedQueueCount) > 0 ? <span className="font-semibold text-ink-muted">Sudah cutoff</span> : <span className="font-semibold text-ok">Aktif</span>}</Td>
          <Td>{row.id === Number(row.firstConsumptionId) && !row.reversedAt && Number(row.closedQueueCount) === 0 ? <ReverseConsumption id={row.id} /> : '—'}</Td>
        </Tr>)}</tbody>
      </Table>
    </Card></Reveal>
  </>;
}
