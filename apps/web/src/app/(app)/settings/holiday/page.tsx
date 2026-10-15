import { MasterEntityPage } from '@/components/master/master-entity-page';
import { requirePermission } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function Page({ searchParams }: { searchParams: Promise<{ page?: string; q?: string }> }) {
  await requirePermission('setting.write');
  return <MasterEntityPage rawEntity="holidays" searchParams={searchParams} view={{
    path: '/settings/holiday', section: 'Setting', title: 'Kalender Libur',
    description: 'Tanggal libur yang dipakai untuk menghitung cutoff dan tanggal kirim',
  }} />;
}
