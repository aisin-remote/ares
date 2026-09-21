import { Users, Share2, AlertTriangle, ClipboardList } from 'lucide-react';
import { getDashboardSummary } from '@/lib/queries';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Stagger, StaggerItem } from '@/components/motion/reveal';

export const dynamic = 'force-dynamic';

/**
 * Dashboard PPIC (PRD F-49).
 *
 * ponytail: kartu picklist hari ini, supplier belum unduh/konfirmasi, dan
 * order blocked menyusul bersama skemanya. Yang ada sekarang hanya angka yang
 * sudah punya tabel.
 */
export default async function DashboardPage() {
  const summary = await getDashboardSummary();

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Dashboard' }]}
        title="Dashboard"
        description="Ringkasan order, kedatangan, dan integrasi hari ini"
      />

      <Stagger className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StaggerItem>
          <StatCard label="Picklist hari ini" value={0} hint="belum ada skema" icon={ClipboardList} />
        </StaggerItem>
        <StaggerItem>
          <StatCard label="Outbox SAP menunggu" value={summary.outboxPending} icon={Share2} />
        </StaggerItem>
        <StaggerItem>
          <StatCard label="GR gagal" value={summary.outboxFailed} icon={AlertTriangle} />
        </StaggerItem>
        <StaggerItem>
          <StatCard label="Pengguna" value={summary.pengguna} icon={Users} />
        </StaggerItem>
      </Stagger>

      <Card className="mt-5">
        <CardHeader
          icon={ClipboardList}
          title="Mulai dari sini"
          subtitle="Kerangka ARES sudah jalan; modul diisi per fase sesuai docs/PRD.md bagian 12."
        />
        <CardBody className="text-[14px] text-ink-soft">
          Fase 1: skema Drizzle (bagian 7) → aturan domain (bagian 6) → order manual → picklist &
          kanban PDF → portal supplier → sesi scan receiving → outbox GR.
        </CardBody>
      </Card>
    </>
  );
}
