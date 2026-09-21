import { AlertTriangle, Database, RefreshCw } from 'lucide-react';
import { getMesStatus } from '@/lib/mes-api';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { MesActions } from '@/components/mes/mes-actions';
import { StatCard } from '@/components/ui/stat-card';
import { Reveal, Stagger, StaggerItem } from '@/components/motion/reveal';

export const dynamic = 'force-dynamic';

export default async function MesPage() {
  const status = await getMesStatus();
  return <>
    <PageHeader crumbs={[{ label: 'Integrasi' }, { label: 'Sinkron MES' }]} title="Sinkron MES" description={`Gateway ${status.gateway} · interval ${status.intervalSec} detik · ${status.enabled ? 'jadwal aktif' : 'jadwal nonaktif'}`} />
    <Stagger className="mb-5 grid gap-5 sm:grid-cols-3">
      <StaggerItem><StatCard label="Cursor" value={Number(status.cursor ?? 0) || 0} hint="production-results" icon={Database} /></StaggerItem>
      <StaggerItem><StatCard label="Record gagal" value={status.failures} hint="menunggu master diperbaiki" icon={AlertTriangle} /></StaggerItem>
      <StaggerItem><StatCard label="Record diproses" value={status.fake.PROCESSED ?? 0} hint={status.syncedAt ? `terakhir ${new Date(status.syncedAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}` : 'belum pernah ditarik'} icon={RefreshCw} /></StaggerItem>
    </Stagger>
    <Reveal><Card>
      <CardHeader icon={RefreshCw} title="Kontrol sinkronisasi" subtitle={status.gateway === 'fake' ? `Mode uji: ${status.fake.PENDING ?? 0} menunggu, ${status.fake.PROCESSED ?? 0} selesai, ${status.fake.FAILED ?? 0} gagal.` : 'Data ditarik dari endpoint production-results dengan cursor tersimpan.'} />
      <CardBody className="border-t border-line"><MesActions fake={status.gateway === 'fake'} /></CardBody>
    </Card></Reveal>
  </>;
}
