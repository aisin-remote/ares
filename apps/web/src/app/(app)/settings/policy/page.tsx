import { MasterEntityPage } from '@/components/master/master-entity-page';

export const dynamic = 'force-dynamic';

export default function Page({ searchParams }: { searchParams: Promise<{ page?: string; q?: string }> }) {
  return <MasterEntityPage rawEntity="vendorCutoffs" searchParams={searchParams} view={{
    path: '/settings/policy', section: 'Setting', title: 'Kebijakan Supplier',
    description: 'Pengiriman kurang dan pembulatan box mengikuti jadwal cutoff supplier',
    listFields: ['vendorId', 'cutoffTime', 'shortShipPolicy', 'rounding', 'isActive'],
  }} />;
}
