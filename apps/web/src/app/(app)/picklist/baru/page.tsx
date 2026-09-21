import { ClipboardList } from 'lucide-react';
import { getOrderOptions } from '@/lib/queries';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader, CardDivider } from '@/components/ui/card';
import { Reveal } from '@/components/motion/reveal';
import { ManualOrderForm } from '@/components/picklist/manual-order-form';

export const dynamic = 'force-dynamic';

/**
 * Order manual (F-17).
 *
 * Tanggal kirim awal dihitung di server dalam zona pabrik, bukan di browser:
 * tablet di lantai produksi tidak selalu benar jamnya, dan nilai awal yang
 * berbeda antara server dan browser membuat React mengeluh saat hidrasi.
 */
export default async function PicklistBaruPage() {
  const vendors = await getOrderOptions();
  const besok = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const tanggalKirim = besok.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Picklist', href: '/picklist' }, { label: 'Order manual' }]}
        title="Order manual"
        description="Terbitkan picklist di luar cutoff — kanban dibuat satu per box"
      />

      <Reveal>
        <Card>
          <CardHeader
            icon={ClipboardList}
            title="Order baru"
            subtitle="Nomor picklist diberikan saat terbit dan tidak pernah dipakai ulang (F-21)"
          />
          <CardDivider />
          <ManualOrderForm vendors={vendors} defaultDeliveryDate={tanggalKirim} />
        </Card>
      </Reveal>
    </>
  );
}
