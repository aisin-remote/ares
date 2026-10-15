'use server';

import { revalidatePath } from 'next/cache';
import { redirect, unstable_rethrow } from 'next/navigation';
import { apiFetch, ApiRequestError } from '@/lib/api';

/**
 * Semua TULIS sesi scan lewat API Nest (aturan repo 1): buka, scan, tutup.
 *
 * Server Action, bukan fetch dari browser: token sesi ada di cookie httpOnly
 * dan tidak pernah turun ke skrip halaman. Di setiap catch, `unstable_rethrow`
 * lebih dulu — apiFetch mengalihkan ke /login dengan cara MELEMPAR, dan kalau
 * lemparan itu tertangkap, sesi habis tampil sebagai "tidak bisa menghubungi
 * server".
 */
function toMessage(err: unknown): string {
  if (err instanceof ApiRequestError) return err.message;
  return 'Tidak bisa menghubungi server. Periksa jaringan.';
}

/** F-34: scan barcode picklist → sesi OPEN (atau lanjutkan yang ada) → layar stasiun. */
export async function openReceiptAction(
  _prev: { error: string | null },
  formData: FormData,
): Promise<{ error: string | null }> {
  const code = String(formData.get('code') ?? '').trim();
  if (!code) return { error: 'Scan atau ketik barcode Order Sheet dulu.' };

  let publicId: string;
  try {
    const res = await apiFetch<{ publicId: string }>('/receipts/open', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
    publicId = res.publicId;
  } catch (err) {
    unstable_rethrow(err);
    return { error: toMessage(err) };
  }
  revalidatePath('/receiving');
  // redirect() melempar; sengaja di luar try supaya tidak ikut tertangkap.
  redirect(`/receiving/${publicId}`);
}

export interface ScanOutcome {
  result: 'OK' | 'DUPLICATE' | 'REJECTED';
  message: string;
  /** Kanban masih PRINTED saat diterima — tanpa konfirmasi supplier (6.4). */
  autoShipped?: boolean;
  kanbanSerial: number | null;
  /** Counter line yang tersentuh (F-35); null bila ditolak. */
  line: { id: number; boxOrdered: number; boxShipped: number | null; boxScanned: number } | null;
  clientRef: string | null;
}

/**
 * F-36: satu scan kanban. Tanpa revalidatePath — layar memperbarui dirinya
 * dari balasan; memuat ulang halaman di antara dua scan beruntun hanya
 * membuat operator menunggu.
 */
export async function scanReceiptAction(input: {
  receiptId: string;
  code: string;
  clientRef: string;
}): Promise<ScanOutcome | { error: string }> {
  try {
    return await apiFetch<ScanOutcome>(`/receipts/${input.receiptId}/scan`, {
      method: 'POST',
      body: JSON.stringify({ code: input.code, clientRef: input.clientRef }),
    });
  } catch (err) {
    unstable_rethrow(err);
    return { error: toMessage(err) };
  }
}

export interface CloseOutcome {
  id: number;
  publicId: string;
  receiptNo: string;
  picklistId: number;
  picklistPublicId: string;
  picklistNo: string;
  picklistStatus: string;
  missingCount: number;
}

/** F-37: tutup sesi; 422 dari API (alasan wajib, 6.5.2) dikembalikan sebagai pesan. */
export async function closeReceiptAction(
  receiptId: string,
  reason: string,
): Promise<CloseOutcome | { error: string }> {
  try {
    const res = await apiFetch<CloseOutcome>(`/receipts/${receiptId}/close`, {
      method: 'POST',
      body: JSON.stringify({ reason: reason.trim() || undefined }),
    });
    revalidatePath('/receiving');
    revalidatePath(`/receiving/${receiptId}/ringkasan`);
    revalidatePath(`/picklist/${res.picklistPublicId}`);
    return res;
  } catch (err) {
    unstable_rethrow(err);
    return { error: toMessage(err) };
  }
}

/** F-40: batalkan receipt; GR yang sudah keluar akan dibuatkan dokumen pembalik. */
export async function cancelReceiptAction(
  receiptId: string,
  reason: string,
): Promise<{ id: number; publicId: string; status: 'CANCELLED'; picklistId: number; picklistPublicId: string; reversalOutboxId: number | null } | { error: string }> {
  try {
    const res = await apiFetch<{ id: number; publicId: string; status: 'CANCELLED'; picklistId: number; picklistPublicId: string; reversalOutboxId: number | null }>(
      `/receipts/${receiptId}/cancel`,
      { method: 'POST', body: JSON.stringify({ reason }) },
    );
    revalidatePath('/receiving');
    revalidatePath(`/receiving/${receiptId}/ringkasan`);
    revalidatePath(`/picklist/${res.picklistPublicId}`);
    revalidatePath('/sap');
    return res;
  } catch (err) {
    unstable_rethrow(err);
    return { error: toMessage(err) };
  }
}
