'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import type { ConfirmShipmentInput } from '@ares/contracts';
import { apiFetch, ApiRequestError } from '@/lib/api';

export interface ConfirmShipmentResult {
  id: number;
  picklistNo: string;
  status: 'SHIPPED';
  short: boolean;
  policy: 'CARRY_OVER' | 'REVISION';
  revision: { id: number; revision: number; lineCount: number } | null;
}

/**
 * F-30 konfirmasi kirim dari portal. Vendor-nya ditentukan API dari token,
 * bukan dari sini. `unstable_rethrow` pertama di catch: apiFetch mengalihkan
 * ke /login dengan cara melempar.
 */
export async function confirmShipmentAction(
  picklistId: number,
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
