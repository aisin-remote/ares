'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import type { StockAdjustInput } from '@ares/contracts';
import { apiFetch, ApiRequestError } from '@/lib/api';

/** F-42: penyesuaian stok lewat API (aturan repo 1); alasan wajib, tercatat di audit. */
export async function adjustStockAction(
  input: StockAdjustInput,
): Promise<{ id: number } | { error: string }> {
  try {
    const res = await apiFetch<{ id: number }>('/stock/adjust', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    revalidatePath('/stock');
    revalidatePath(`/stock/${input.partId}`);
    return res;
  } catch (err) {
    unstable_rethrow(err);
    if (err instanceof ApiRequestError) {
      const details = (err.body as { details?: Array<{ message?: string }> } | null)?.details;
      return { error: details?.[0]?.message ?? err.message };
    }
    return { error: 'Tidak bisa menghubungi server.' };
  }
}
