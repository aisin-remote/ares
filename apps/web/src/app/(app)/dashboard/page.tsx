import Link from 'next/link';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock3,
  Download,
  ListChecks,
  ListX,
  Share2,
  Truck,
} from 'lucide-react';
import { PICKLIST_STATUSES, type PicklistStatus } from '@ares/contracts';
import {
  getDashboardSummary,
  getDeliveryDateRange,
  getMasterOptions,
  getNextCutoffPreviews,
} from '@/lib/queries';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { Card, CardDivider, CardHeader } from '@/components/ui/card';
import { Table, Th, Td, Tr, EmptyState } from '@/components/ui/table';
import { Stagger, StaggerItem, Reveal } from '@/components/motion/reveal';
import { STATUS_LABEL, STATUS_TONE, waktuRelatif } from '@/components/picklist/status';
import { cn } from '@/components/ui/cn';
import { DeliveryGantt } from '@/components/dashboard/delivery-gantt';
import { requirePermission } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** Dashboard operasional PPIC dari keadaan transaksi saat ini (F-49). */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ start_date?: string; end_date?: string; plant?: string }>;
}) {
  const user = await requirePermission('picklist.read');
  const params = await searchParams;
  const { startDate, endDate } = getDeliveryDateRange(params);
  const now = new Date();
  const [plantOptions, cutoffPreviews] = await Promise.all([
    getMasterOptions('plants'),
    getNextCutoffPreviews(now, user.plantId ?? undefined),
  ]);
  const selectedPlant =
    params.plant && params.plant !== 'ALL'
      ? plantOptions.find((plant) => plant.short === params.plant)
      : undefined;
  const summary = await getDashboardSummary({
    startDate,
    endDate,
    plantId: user.plantId ?? undefined,
    deliveryPlantId: selectedPlant?.value ?? null,
  });
  const belumUnduh = summary.supplierTertinggal.reduce((n, row) => n + row.belumUnduh, 0);
  const belumKonfirmasi = summary.supplierTertinggal.reduce((n, row) => n + row.belumKonfirmasi, 0);
  const cutoffDekat = cutoffPreviews
    .filter(
      (item) =>
        item.cutoffAt &&
        item.cutoffAt.getTime() >= now.getTime() &&
        item.cutoffAt.getTime() <= now.getTime() + 60 * 60_000,
    )
    .sort((a, b) => a.cutoffAt!.getTime() - b.cutoffAt!.getTime());
  const tindakan = [
    {
      key: 'download',
      title: `${belumUnduh} Order Sheet belum diunduh`,
      detail: 'Supplier sudah melewati batas waktu unduh.',
      href: '/picklist?status=ISSUED',
      icon: Download,
      tone: 'warn' as const,
      count: belumUnduh,
    },
    {
      key: 'confirm',
      title: `${belumKonfirmasi} pengiriman belum dikonfirmasi`,
      detail: 'Waktu kedatangan semakin dekat, supplier perlu diingatkan.',
      href: '/picklist?status=DOWNLOADED',
      icon: Truck,
      tone: 'warn' as const,
      count: belumKonfirmasi,
    },
    {
      key: 'blocked',
      title: `${summary.blockedQueues.length} antrean order terblokir`,
      detail: 'Jumlah order melebihi sisa PO yang tersedia.',
      href: '/queue',
      icon: ListX,
      tone: 'danger' as const,
      count: summary.blockedQueues.length,
    },
    {
      key: 'sap',
      title: `${summary.grFailed} pengiriman data GR gagal`,
      detail: 'Periksa pesan kegagalan dan jalankan pengiriman ulang.',
      href: '/sap?status=FAILED',
      icon: AlertTriangle,
      tone: 'danger' as const,
      count: Number(summary.grFailed),
    },
    {
      key: 'cutoff',
      title: `${cutoffDekat.length} cutoff dalam satu jam`,
      detail: cutoffDekat[0]?.cutoffAt
        ? `${cutoffDekat[0].vendorName} paling dekat, ${waktuRelatif(cutoffDekat[0].cutoffAt, now).durasi} lagi.`
        : '',
      href: '/queue',
      icon: Clock3,
      tone: 'warn' as const,
      count: cutoffDekat.length,
    },
  ].filter((item) => item.count > 0);

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Dashboard' }]}
        title="Dashboard"
        description="Ringkasan Order Sheet, supplier, dan integrasi GR saat ini"
      />

      <Reveal className="mb-5">
        <Card>
          <CardHeader
            icon={ListChecks}
            title="Perlu tindakan Anda"
            subtitle={
              tindakan.length
                ? `${tindakan.length} jenis pekerjaan perlu diperiksa`
                : 'Tidak ada pekerjaan mendesak saat ini'
            }
          />
          <CardDivider />
          {tindakan.length ? (
            <div className="grid gap-px bg-line sm:grid-cols-2 xl:grid-cols-3">
              {tindakan.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.key}
                    href={item.href}
                    className="group flex min-w-0 items-start gap-3 bg-card px-5 py-4 transition-colors hover:bg-surface"
                  >
                    <span
                      className={cn(
                        'grid size-10 shrink-0 place-items-center rounded-xl',
                        item.tone === 'danger' ? 'bg-ng/10 text-ng' : 'bg-warn/10 text-warn',
                      )}
                    >
                      <Icon className="size-[18px]" strokeWidth={2} aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] font-bold text-ink">{item.title}</span>
                      <span className="mt-1 block text-[12px] leading-5 text-ink-muted">
                        {item.detail}
                      </span>
                    </span>
                    <ChevronRight
                      className="mt-2 size-4 shrink-0 text-ink-muted transition-transform group-hover:translate-x-0.5 group-hover:text-ink"
                      aria-hidden
                    />
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="flex items-center gap-3 px-5 py-5 text-[14px] text-ok">
              <CheckCircle2 className="size-5 shrink-0" strokeWidth={2} aria-hidden />
              Semua aman. Belum ada order, antrean, atau GR yang perlu ditindaklanjuti.
            </div>
          )}
        </Card>
      </Reveal>

      <Stagger className="grid gap-5 sm:grid-cols-2 xl:grid-cols-5">
        <StaggerItem>
          <StatCard
            label="Order Sheet hari ini"
            value={summary.totalPicklistHariIni}
            hint="semua status"
            icon={ClipboardList}
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            label="Belum diunduh"
            value={belumUnduh}
            hint="Order Sheet supplier"
            icon={Download}
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            label="Belum dikonfirmasi"
            value={belumKonfirmasi}
            hint="sudah diunduh"
            icon={ClipboardList}
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            label="GR gagal"
            value={summary.grFailed}
            hint={`${summary.outboxPending} menunggu kirim`}
            icon={AlertTriangle}
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            label="Antrean blocked"
            value={summary.blockedQueues.length}
            hint="melebihi open qty PO"
            icon={ListX}
          />
        </StaggerItem>
      </Stagger>

      <Reveal>
        <DeliveryGantt
          schedules={summary.deliverySchedule}
          start={summary.deliveryWindow.start}
          end={summary.deliveryWindow.end}
          startDate={startDate}
          endDate={endDate}
          plants={[
            { value: 'ALL', label: 'ALL' },
            ...plantOptions.map((plant) => ({ value: plant.short!, label: plant.short! })),
          ]}
          selectedPlant={selectedPlant?.short ?? 'ALL'}
        />
      </Reveal>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <Reveal>
          <Card>
            <CardHeader
              icon={ClipboardList}
              title="Order Sheet terbit hari ini"
              subtitle={`${summary.totalPicklistHariIni} Order Sheet`}
            />
            <Table>
              <thead>
                <tr>
                  <Th>Status</Th>
                  <Th align="right">Jumlah</Th>
                </tr>
              </thead>
              <tbody>
                {(PICKLIST_STATUSES as readonly PicklistStatus[]).map((status) => (
                  <Tr key={status}>
                    <Td>
                      <span
                        className={cn(
                          'inline-flex rounded-full border px-2.5 py-1 text-[12px] font-semibold',
                          STATUS_TONE[status] ?? 'border-line',
                        )}
                      >
                        {STATUS_LABEL[status] ?? status}
                      </span>
                    </Td>
                    <Td align="right" className="tabular font-semibold">
                      {summary.picklistHariIni[status] ?? 0}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </Reveal>

        <Reveal delayMs={60}>
          <Card>
            <CardHeader
              icon={Share2}
              title="Supplier perlu tindak lanjut"
              subtitle="Order Sheet aktif yang belum diunduh atau dikonfirmasi"
            />
            <Table>
              <thead>
                <tr>
                  <Th>Supplier</Th>
                  <Th align="right">Belum unduh</Th>
                  <Th align="right">Belum konfirmasi</Th>
                </tr>
              </thead>
              <tbody>
                {summary.supplierTertinggal.length === 0 ? (
                  <EmptyState colSpan={3}>
                    Semua supplier sudah menindaklanjuti Order Sheet aktif.
                  </EmptyState>
                ) : (
                  summary.supplierTertinggal.map((row) => (
                    <Tr key={row.vendorId}>
                      <Td strong>{row.vendorName}</Td>
                      <Td align="right" className="tabular">
                        {row.belumUnduh}
                      </Td>
                      <Td align="right" className="tabular">
                        {row.belumKonfirmasi}
                      </Td>
                    </Tr>
                  ))
                )}
              </tbody>
            </Table>
          </Card>
        </Reveal>
      </div>

      {summary.blockedQueues.length > 0 ? (
        <Reveal className="mt-5">
          <Card>
            <CardHeader
              icon={ListX}
              title="Antrean tertahan oleh open qty PO"
              subtitle="Kurangi jumlah antrean atau perbarui open qty PO sebelum cutoff dijalankan kembali"
            />
            <Table>
              <thead>
                <tr>
                  <Th>Supplier</Th>
                  <Th>Part</Th>
                  <Th align="right">Pcs antrean</Th>
                  <Th>Cutoff</Th>
                  <Th>Alasan</Th>
                </tr>
              </thead>
              <tbody>
                {summary.blockedQueues.map((row) => (
                  <Tr key={row.id}>
                    <Td strong>{row.vendorName}</Td>
                    <Td className="tabular">{row.partNo}</Td>
                    <Td align="right" className="tabular">
                      {row.pcs}
                    </Td>
                    <Td className="tabular whitespace-nowrap">
                      {new Intl.DateTimeFormat('id-ID', {
                        timeZone: 'Asia/Jakarta',
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      }).format(row.cutoffAt)}
                    </Td>
                    <Td className="max-w-xl text-[12px] text-ng">{row.reason}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </Reveal>
      ) : null}
    </>
  );
}
