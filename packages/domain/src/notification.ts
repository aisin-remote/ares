import type { EmailDeliveryStatus } from '@ares/contracts';

/** F-31: satu permintaan aktif per order dan jeda untuk mencegah klik ganda. */
export function noticeResendBlock(
  orderStatus: string,
  latest: { status: EmailDeliveryStatus; createdAt: Date } | undefined,
  now = new Date(),
): string | null {
  if (orderStatus === 'CANCELLED') return 'Order sudah dibatalkan; email tidak bisa dikirim ulang.';
  if (latest?.status === 'QUEUED' || latest?.status === 'PROCESSING')
    return 'Email masih diproses. Tunggu sampai prosesnya selesai.';
  if (latest && now.getTime() - latest.createdAt.getTime() < 60_000)
    return 'Tunggu satu menit dari permintaan terakhir sebelum mengirim ulang.';
  return null;
}
