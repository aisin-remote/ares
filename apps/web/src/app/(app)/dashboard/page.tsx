import { AlertTriangle, ClipboardList, Download, Share2 } from 'lucide-react';
import { PICKLIST_STATUSES, type PicklistStatus } from '@ares/contracts';
import { getDashboardSummary } from '@/lib/queries';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { Card, CardHeader } from '@/components/ui/card';
import { Table, Th, Td, Tr, EmptyState } from '@/components/ui/table';
import { Stagger, StaggerItem, Reveal } from '@/components/motion/reveal';
import { STATUS_LABEL, STATUS_TONE } from '@/components/picklist/status';
import { cn } from '@/components/ui/cn';

export const dynamic = 'force-dynamic';

/** Dashboard operasional PPIC dari keadaan transaksi saat ini (F-49). */
export default async function DashboardPage() {
  const summary = await getDashboardSummary();
  const belumUnduh = summary.supplierTertinggal.reduce((n, row) => n + row.belumUnduh, 0);
  const belumKonfirmasi = summary.supplierTertinggal.reduce(
    (n, row) => n + row.belumKonfirmasi, 0,
  );

  return (
    <>
      <PageHeader crumbs={[{ label: 'Dashboard' }]} title="Dashboard"
        description="Ringkasan picklist, supplier, dan integrasi GR saat ini" />

      <Stagger className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StaggerItem><StatCard label="Picklist hari ini" value={summary.totalPicklistHariIni}
          hint="semua status" icon={ClipboardList} /></StaggerItem>
        <StaggerItem><StatCard label="Belum diunduh" value={belumUnduh}
          hint="picklist supplier" icon={Download} /></StaggerItem>
        <StaggerItem><StatCard label="Belum dikonfirmasi" value={belumKonfirmasi}
          hint="sudah diunduh" icon={ClipboardList} /></StaggerItem>
        <StaggerItem><StatCard label="GR gagal" value={summary.grFailed}
          hint={`${summary.outboxPending} menunggu kirim`} icon={AlertTriangle} /></StaggerItem>
      </Stagger>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <Reveal>
          <Card>
            <CardHeader icon={ClipboardList} title="Picklist terbit hari ini"
              subtitle={`${summary.totalPicklistHariIni} picklist`} />
            <Table>
              <thead><tr><Th>Status</Th><Th align="right">Jumlah</Th></tr></thead>
              <tbody>
                {(PICKLIST_STATUSES as readonly PicklistStatus[]).map((status) => (
                  <Tr key={status}>
                    <Td><span className={cn('inline-flex rounded-full border px-2.5 py-1 text-[12px] font-semibold', STATUS_TONE[status] ?? 'border-line')}>
                      {STATUS_LABEL[status] ?? status}</span></Td>
                    <Td align="right" className="tabular font-semibold">
                      {summary.picklistHariIni[status] ?? 0}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </Reveal>

        <Reveal delayMs={60}>
          <Card>
            <CardHeader icon={Share2} title="Supplier perlu tindak lanjut"
              subtitle="Picklist aktif yang belum diunduh atau dikonfirmasi" />
            <Table>
              <thead><tr><Th>Supplier</Th><Th align="right">Belum unduh</Th><Th align="right">Belum konfirmasi</Th></tr></thead>
              <tbody>
                {summary.supplierTertinggal.length === 0 ? (
                  <EmptyState colSpan={3}>Semua supplier sudah menindaklanjuti picklist aktif.</EmptyState>
                ) : summary.supplierTertinggal.map((row) => (
                  <Tr key={row.vendorId}>
                    <Td strong>{row.vendorName}</Td>
                    <Td align="right" className="tabular">{row.belumUnduh}</Td>
                    <Td align="right" className="tabular">{row.belumKonfirmasi}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </Reveal>
      </div>
    </>
  );
}
