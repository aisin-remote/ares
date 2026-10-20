import { OrderStandardPage } from '@/components/master/order-standard-page';
import { getOrderStandardOptions } from '@/lib/queries';
import { requirePermission } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function NewOrderStandardPage() {
  await requirePermission('master.read');
  return <OrderStandardPage vendors={await getOrderStandardOptions()} />;
}
