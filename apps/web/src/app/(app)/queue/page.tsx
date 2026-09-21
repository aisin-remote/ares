import { ListOrdered } from 'lucide-react';
import { listOpenOrderQueues } from '@/lib/queries';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState, Table, Td, Th, Tr } from '@/components/ui/table';
import { Reveal } from '@/components/motion/reveal';
import { QueueControls } from '@/components/queue/queue-controls';
import { RunCutoffButton } from '@/components/queue/run-cutoff-button';

export const dynamic = 'force-dynamic';

export default async function QueuePage() {
  const rows = await listOpenOrderQueues();
  const pcs = rows.reduce((sum, row) => sum + row.pcs + row.carryOverPcs, 0);
  return <>
    <PageHeader crumbs={[{ label: 'Operasi' }, { label: 'Antrean Order' }]} title="Antrean order" description={`${rows.length} vendor part OPEN · ${pcs.toLocaleString('id-ID')} pcs kebutuhan`} />
    <Reveal><Card>
      <CardHeader
        icon={ListOrdered}
        title="Kebutuhan per cutoff"
        subtitle="PPIC dapat mengoreksi PCS atau menahan vendor part; setiap perubahan wajib beralasan dan diaudit."
        actions={<RunCutoffButton />}
      />
      <Table><thead><tr><Th>Supplier</Th><Th>Part</Th><Th>Back no</Th><Th align="right">Pcs</Th><Th align="right">Carry over</Th><Th align="right">≈ Box</Th><Th>Cutoff berikutnya</Th><Th>Status</Th><Th>Aksi</Th></tr></thead>
        <tbody>{rows.length === 0 ? <EmptyState colSpan={9}>Belum ada antrean OPEN. Antrean bertambah setelah hasil produksi MES diproses.</EmptyState> : rows.map((row) => <Tr key={row.id}>
          <Td>{row.vendorName}</Td><Td strong>{row.partNo}<span className="ml-2 font-normal text-ink-muted">{row.partName}</span></Td><Td>{row.backNo}</Td>
          <Td align="right" className="tabular font-semibold">{row.pcs.toLocaleString('id-ID')}</Td><Td align="right" className="tabular">{row.carryOverPcs.toLocaleString('id-ID')}</Td><Td align="right" className="tabular">{row.boxes.toLocaleString('id-ID')}</Td>
          <Td className="whitespace-nowrap">{row.cutoffAt.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</Td>
          <Td>{row.hold ? <span className="font-semibold text-warn">Ditahan</span> : row.blockedReason ? <div className="max-w-64"><span className="font-semibold text-ng">Blocked</span><p className="mt-1 text-[12px] leading-4 text-ink-muted">{row.blockedReason}</p></div> : <span className="font-semibold text-ok">OPEN</span>}</Td>
          <Td><QueueControls id={row.id} hold={row.hold} /></Td>
        </Tr>)}</tbody>
      </Table>
    </Card></Reveal>
  </>;
}
