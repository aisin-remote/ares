import { notFound, redirect } from 'next/navigation';
import { getReceiptDetail } from '@/lib/queries';
import { getSessionUser } from '@/lib/session';
import { ReceivingStation } from '@/components/scan/receiving-station';

export const dynamic = 'force-dynamic';

/**
 * Layar stasiun receiving — memenuhi layar, tanpa menu (PRD §10.4).
 *
 * Berada di route group (station) yang punya layout sendiri, sehingga sidebar
 * tidak ikut dirender. Alamatnya tetap /receiving/<id>: route group tidak
 * memengaruhi URL. Sesi yang sudah ditutup diarahkan ke ringkasannya — layar
 * scan tanpa sesi terbuka hanya akan menolak semua tembakan.
 */
export default async function ReceivingStationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const receiptId = Number(id);
  if (!Number.isInteger(receiptId) || receiptId <= 0) notFound();

  const [user, session] = await Promise.all([getSessionUser(), getReceiptDetail(receiptId)]);
  if (!session) notFound();
  if (session.status !== 'OPEN') redirect(`/receiving/${receiptId}/ringkasan`);

  return <ReceivingStation session={session} userName={user?.name ?? '—'} npk={user?.npk ?? '—'} />;
}
