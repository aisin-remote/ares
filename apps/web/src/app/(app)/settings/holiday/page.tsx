import { MasterEntityPage } from '@/components/master/master-entity-page';

export const dynamic = 'force-dynamic';

export default function Page({ searchParams }: { searchParams: Promise<{ page?: string; q?: string }> }) {
  return <MasterEntityPage rawEntity="holidays" searchParams={searchParams} view={{
    path: '/settings/holiday', section: 'Setting', title: 'Kalender Libur',
    description: 'Tanggal libur yang dipakai untuk menghitung cutoff dan tanggal kirim',
  }} />;
}
