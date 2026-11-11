'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { apiFetch, ApiRequestError } from '@/lib/api';
import type { MasterSyncJob, PoSyncJob } from '@ares/contracts';
import { requirePermission } from '@/lib/session';

export async function syncPoAction(month: string, preview: boolean): Promise<{ queued: true; jobId?: string } | { error: string }> {
  await requirePermission('sap.po.sync');
  try {
    return await apiFetch('/sap/po/sync', { method: 'POST', body: JSON.stringify({ month, preview }) });
  } catch (err) {
    unstable_rethrow(err);
    return { error: toMessage(err) };
  }
}

/** F-01/F-02: tarik master dari staging SAP lewat worker. */
export async function syncMasterAction(preview: boolean): Promise<{ queued: true; jobId?: string } | { error: string }> {
  await requirePermission('sap.master.sync');
  try {
    return await apiFetch('/sap/master/sync', { method: 'POST', body: JSON.stringify({ preview }) });
  } catch (err) {
    unstable_rethrow(err);
    return { error: toMessage(err) };
  }
}

export async function masterJobAction(jobId: string): Promise<MasterSyncJob | { error: string }> {
  await requirePermission('outbox.read');
  try {
    const result = await apiFetch<MasterSyncJob>(`/sap/master/jobs/${encodeURIComponent(jobId)}`);
    if (result.state === 'completed') revalidatePath('/sap');
    return result;
  } catch (err) {
    unstable_rethrow(err);
    return { error: toMessage(err) };
  }
}

/** F-44: tanggal tarik PO bulanan. */
export async function setPoPullDayAction(day: number): Promise<{ pullDay: number } | { error: string }> {
  await requirePermission('setting.write');
  try {
    const res = await apiFetch<{ pullDay: number }>('/sap/po/schedule', { method: 'PUT', body: JSON.stringify({ day }) });
    revalidatePath('/sap');
    return res;
  } catch (err) {
    unstable_rethrow(err);
    return { error: toMessage(err) };
  }
}

export async function poJobAction(jobId: string): Promise<PoSyncJob | { error: string }> {
  await requirePermission('outbox.read');
  try {
    const result = await apiFetch<PoSyncJob>(`/sap/po/jobs/${encodeURIComponent(jobId)}`);
    if (result.state === 'completed') revalidatePath('/sap');
    return result;
  } catch (err) {
    unstable_rethrow(err);
    return { error: toMessage(err) };
  }
}

function toMessage(err: unknown): string {
  if (err instanceof ApiRequestError) return err.message;
  return 'Sistem tidak bisa dihubungi. Periksa jaringan.';
}

/** Mengumpulkan sekarang juga, tanpa menunggu putaran berikutnya. */
export async function collectNowAction(): Promise<
  { dikumpulkan: number; ditahan: number; dilewati: number; dilepas: number } | { error: string }
> {
  try {
    const res = await apiFetch<{
      dikumpulkan: number;
      ditahan: number;
      dilewati: number;
      dilepas: number;
    }>('/sap/collect', { method: 'POST' });
    revalidatePath('/sap');
    return res;
  } catch (err) {
    unstable_rethrow(err);
    return { error: toMessage(err) };
  }
}

export async function retryAction(ids: number[]): Promise<
  { diulang: number; tetapDitahan: number; dijadwalkan: boolean } | { error: string }
> {
  try {
    const res = await apiFetch<{ diulang: number; tetapDitahan: number; dijadwalkan: boolean }>('/sap/retry', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    });
    revalidatePath('/sap');
    return res;
  } catch (err) {
    unstable_rethrow(err);
    return { error: toMessage(err) };
  }
}

export async function holdAction(ids: number[]): Promise<{ ditahan: number } | { error: string }> {
  try {
    const res = await apiFetch<{ ditahan: number }>('/sap/hold', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    });
    revalidatePath('/sap');
    return res;
  } catch (err) {
    unstable_rethrow(err);
    return { error: toMessage(err) };
  }
}
