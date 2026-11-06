import { notFound } from 'next/navigation';
import { performancePeriod, supplierPerformanceCsv } from '@ares/domain';
import { requirePermission } from '@/lib/session';
import { getSupplierPerformance } from '@/lib/supplier-performance';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const user = await requirePermission('report.arrival.read');
  if (user.plantId === null || user.vendorId !== null) notFound();
  const query = new URL(request.url).searchParams;
  try {
    const period = performancePeriod({ from: query.get('from') ?? undefined, to: query.get('to') ?? undefined,
      tolerance: query.get('tolerance') ?? undefined }, new Date());
    const rawVendor = query.get('vendor');
    if (rawVendor && (!/^\d+$/.test(rawVendor) || !Number.isSafeInteger(Number(rawVendor)) || Number(rawVendor) < 1))
      return new Response('Pilih supplier yang valid.', { status: 400 });
    const report = await getSupplierPerformance(user.plantId, { ...period, vendorId: rawVendor ? Number(rawVendor) : undefined });
    return new Response(supplierPerformanceCsv(report, period), { headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="performa-supplier-${period.from}-${period.to}.csv"`,
      'Cache-Control': 'private, no-store',
    } });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (/^(Isi periode|Maksimal|Toleransi|Lebih dari)/.test(message)) return new Response(message, { status: 400 });
    console.error('[ekspor performa supplier]', error);
    return new Response('Ekspor belum bisa dibuat. Coba lagi beberapa saat lagi.', { status: 500 });
  }
}
