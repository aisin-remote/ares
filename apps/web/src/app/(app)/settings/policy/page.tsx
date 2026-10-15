import { MasterEntityPage } from '@/components/master/master-entity-page';
import { requirePermission } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function Page({ searchParams }: { searchParams: Promise<{ page?: string; q?: string }> }) {
  await requirePermission('setting.write');
  return <MasterEntityPage rawEntity="vendorCutoffs" searchParams={searchParams} view={{
    path: '/settings/policy', section: 'Setting', title: 'Kebijakan Pembulatan',
    description: 'Aturan pembulatan box per jadwal cutoff. Kekurangan kirim otomatis menjadi Order Sheet recovery.',
    listFields: ['vendorId', 'cutoffTime', 'rounding', 'isActive'],
  }} />;
}
