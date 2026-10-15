import { redirect } from 'next/navigation';
import { Monitor } from 'lucide-react';
import { BrandMark } from '@/components/shell/brand-mark';
import { DeliveryGantt } from '@/components/dashboard/delivery-gantt';
import { getDashboardSummary, getDeliveryDateRange } from '@/lib/queries';
import { getDisplaySession } from '@/lib/session';
import { MonitorHeartbeat } from './monitor-heartbeat';

export const dynamic = 'force-dynamic';

export default async function ReceivingDisplayPage({
  searchParams,
}: {
  searchParams: Promise<{ start_date?: string; end_date?: string }>;
}) {
  const device = await getDisplaySession();
  if (!device) redirect('/display/setup');
  const { startDate, endDate } = getDeliveryDateRange(await searchParams);
  const summary = await getDashboardSummary({ startDate, endDate, plantId: device.plantId });

  return <main className="min-h-screen p-4 sm:p-6">
    <header className="flex flex-wrap items-center justify-between gap-4 rounded-panel border border-line bg-shell px-6 py-5 shadow-card">
      <div className="flex items-center gap-5">
        <BrandMark tagline="Jadwal Receiving" />
        <span className="hidden h-9 w-px bg-line sm:block" />
        <div className="hidden items-center gap-2 text-[12px] text-ink-muted sm:flex">
          <Monitor className="size-4" aria-hidden />
          <span>{device.name}</span>
          <span className="rounded-full border border-line bg-surface px-2.5 py-1 font-mono text-[10px] font-semibold text-ink-soft">
            {device.code}
          </span>
        </div>
      </div>
      <MonitorHeartbeat />
    </header>

    <DeliveryGantt schedules={summary.deliverySchedule}
      start={summary.deliveryWindow.start} end={summary.deliveryWindow.end}
      startDate={startDate} endDate={endDate} interactive={false} />
  </main>;
}
