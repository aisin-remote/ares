import { ListOrdered } from 'lucide-react';
import type { OrderStandardOption } from '@/lib/queries';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardDivider, CardHeader } from '@/components/ui/card';
import { Reveal } from '@/components/motion/reveal';
import { OrderStandardForm } from './order-standard-form';

export function OrderStandardPage({ vendors }: { vendors: OrderStandardOption[] }) {
  const configured = vendors.reduce(
    (total, vendor) =>
      total + vendor.parts.filter((part) => part.standardKanban !== null).length,
    0,
  );

  return (
    <>
      <PageHeader
        crumbs={[
          { label: 'Master Data' },
          { label: 'Standar Order', href: '/master/orderStandards' },
          { label: 'Tambah' },
        ]}
        title="Tambah Standar Order"
        description={`${configured} supplier-part sudah memiliki standar — pilih supplier untuk menambah atau memperbarui nilainya`}
      />
      <Reveal>
        <Card>
          <CardHeader
            icon={ListOrdered}
            title="Standar per supplier"
            subtitle="Pilih supplier, lalu isi jumlah kanban normal untuk setiap part"
          />
          <CardDivider />
          <OrderStandardForm vendors={vendors} />
        </Card>
      </Reveal>
    </>
  );
}
