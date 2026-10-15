'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import type { IssueManualPicklistInput, OverrideShipmentInput } from '@ares/contracts';
import { apiFetch, apiUpload, ApiRequestError } from '@/lib/api';

/**
 * Semua TULIS picklist lewat API Nest (aturan repo 1). Halaman hanya membaca
 * database; aturan bisnisnya tetap satu tempat di apps/api.
 */
function toMessage(err: unknown): string {
  if (err instanceof ApiRequestError) {
    const rincian = rincianValidasi(err.body);
    return rincian ? `${err.message}: ${rincian}` : err.message;
  }
  return 'Tidak bisa menghubungi server.';
}

/** Galat validasi membawa `details` per kolom; tanpa itu pesannya terlalu umum. */
function rincianValidasi(body: unknown): string | null {
  const details = (body as { details?: Array<{ field?: string; message?: string }> } | null)
    ?.details;
  if (!Array.isArray(details) || details.length === 0) return null;
  return details.map((d) => [d.field, d.message].filter(Boolean).join(' ')).join('; ');
}

export interface IssueResult {
  id: number;
  publicId: string;
  picklistNo: string;
  revision: number;
  lineCount: number;
  kanbanCount: number;
}

/** F-17 order manual. */
export async function issueManualAction(
  input: IssueManualPicklistInput,
): Promise<IssueResult | { error: string }> {
  try {
    const res = await apiFetch<IssueResult>('/picklists', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    revalidatePath('/picklist');
    return res;
  } catch (err) {
    // apiFetch mengalihkan ke /login saat 401 dengan cara MELEMPAR. Kalau
    // lemparan itu ikut tertangkap di sini, sesi habis muncul sebagai "tidak
    // bisa menghubungi server" dan pengguna terjebak di form.
    unstable_rethrow(err);
    return { error: toMessage(err) };
  }
}

/** F-17: satu template Excel menerbitkan satu picklist manual. */
export async function importManualAction(
  _state: IssueResult | { error: string } | null,
  formData: FormData,
): Promise<IssueResult | { error: string }> {
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { error: 'Pilih berkas Excel (.xlsx) dulu.' };
  const upload = new FormData();
  upload.set('file', file, file.name);
  try {
    const result = await apiUpload<IssueResult>('/picklists/import', upload);
    revalidatePath('/picklist');
    return result;
  } catch (err) {
    unstable_rethrow(err);
    return { error: toMessage(err) };
  }
}

/** F-20 pembatalan sebelum dikirim. */
export async function cancelPicklistAction(
  reference: string,
  reason: string,
): Promise<{ id: number; kanbanCount: number } | { error: string }> {
  try {
    const res = await apiFetch<{ id: number; kanbanCount: number }>(`/picklists/${reference}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
    revalidatePath('/picklist');
    revalidatePath(`/picklist/${reference}`);
    return res;
  } catch (err) {
    unstable_rethrow(err);
    return { error: toMessage(err) };
  }
}

/** 6.3.4: koreksi jumlah box terkirim oleh PPIC sebelum receiving dibuka. */
export async function overrideShipmentAction(
  reference: string,
  input: OverrideShipmentInput,
): Promise<{ id: number; status: 'SHIPPED' } | { error: string }> {
  try {
    const res = await apiFetch<{ id: number; status: 'SHIPPED' }>(
      `/picklists/${reference}/override-shipment`,
      { method: 'POST', body: JSON.stringify(input) },
    );
    revalidatePath('/picklist');
    revalidatePath(`/picklist/${reference}`);
    revalidatePath('/queue');
    return res;
  } catch (err) {
    unstable_rethrow(err);
    return { error: toMessage(err) };
  }
}
