'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { apiFetch, ApiRequestError } from '@/lib/api';

export interface MesActionState { ok?: string; error?: string }
const message = (error: unknown) => error instanceof ApiRequestError ? error.message : 'Tidak bisa menghubungi server.';

export async function syncMesAction(): Promise<MesActionState> {
  try {
    await apiFetch('/mes/sync', { method: 'POST' });
    revalidatePath('/mes');
    return { ok: 'Tarik MES dimasukkan ke antrean kerja.' };
  } catch (error) {
    unstable_rethrow(error);
    return { error: message(error) };
  }
}

export async function addFakeMesAction(_previous: MesActionState, form: FormData): Promise<MesActionState> {
  try {
    await apiFetch('/mes/fake', { method: 'POST', body: JSON.stringify({
      id: String(form.get('id') ?? ''),
      partNo: String(form.get('partNo') ?? ''),
      qty: Number(form.get('qty')),
      line: String(form.get('line') ?? ''),
      producedAt: new Date(String(form.get('producedAt') ?? '')).toISOString(),
    }) });
    revalidatePath('/mes');
    return { ok: 'Record uji ditambahkan. Tekan Tarik sekarang untuk memprosesnya.' };
  } catch (error) {
    unstable_rethrow(error);
    return { error: message(error) };
  }
}
