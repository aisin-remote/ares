'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import type { ConfirmShipmentInput } from '@ares/contracts';
import { apiFetch, ApiRequestError } from '@/lib/api';

export interface ConfirmShipmentResult {
  id: number;
  publicId: string;
  picklistNo: string;
  status: 'SHIPPED';
  short: boolean;
  policy: 'REVISION';
  revision: { id: number; publicId: string; revision: number; lineCount: number } | null;
}

/**
 * F-30 konfirmasi kirim dari portal. Vendor-nya ditentukan API dari token,
 * bukan dari sini. `unstable_rethrow` pertama di catch: apiFetch mengalihkan
 * ke /login dengan cara melempar.
 */
export async function confirmShipmentAction(
  picklistId: string,
  input: ConfirmShipmentInput,
): Promise<ConfirmShipmentResult | { error: string }> {
  try {
    const res = await apiFetch<ConfirmShipmentResult>(`/picklists/${picklistId}/confirm-shipment`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
    revalidatePath('/portal');
    revalidatePath(`/portal/${picklistId}`);
    revalidatePath(`/picklist/${picklistId}`);
    return res;
  } catch (err) {
    unstable_rethrow(err);
    if (err instanceof ApiRequestError) return { error: err.message };
    return { error: 'Tidak bisa menghubungi server. Periksa jaringan.' };
  }
}

/**
 * Supplier memperbarui atribut kemasan vendor part-nya (back number, rak,
 * tipe box). Kolom lain ditolak API; vendorId diambil dari token di sana.
 */
export async function updateVendorPartAction(
  vendorPartId: number,
  input: { backNo: string; rack: string; boxType: string },
): Promise<{ ok: true; changed: number } | { error: string }> {
  try {
    const res = await apiFetch<{ changes: unknown[] }>(
      `/master/vendorParts/${vendorPartId}/kemasan`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          backNo: input.backNo.trim(),
          rack: input.rack.trim(),
          boxType: input.boxType.trim(),
        }),
      },
    );
    revalidatePath('/portal/vendor-part');
    return { ok: true, changed: res.changes.length };
  } catch (err) {
    unstable_rethrow(err);
    if (err instanceof ApiRequestError) {
      const details = (err.body as { details?: Array<{ message?: string }> } | null)?.details;
      return { error: details?.[0]?.message ?? err.message };
    }
    return { error: 'Tidak bisa menghubungi server.' };
  }
}
