'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { getEntityDef, isMasterEntity } from '@ares/contracts';
import { apiFetch, apiUpload, ApiRequestError } from '@/lib/api';

export type FormState = { ok?: boolean; error?: string; fieldErrors?: Record<string, string> };

function errorState(error: unknown): FormState {
  if (error instanceof ApiRequestError) {
    const details = (error.body as { details?: Array<{ field: string; message: string }> } | null)
      ?.details;
    if (details?.length)
      return {
        error: error.message,
        fieldErrors: Object.fromEntries(details.map((d) => [d.field, d.message])),
      };
    return { error: error.message };
  }
  return { error: 'Tidak bisa menghubungi server.' };
}

function refreshMaster(entity: string) {
  revalidatePath(`/master/${entity}`);
  revalidatePath('/settings/cutoff');
  revalidatePath('/settings/policy');
  revalidatePath('/settings/holiday');
  revalidatePath('/picklist/baru');
}

export async function saveMasterAction(_state: FormState, formData: FormData): Promise<FormState> {
  const rawEntity = String(formData.get('__entity') ?? '');
  if (!isMasterEntity(rawEntity)) return { error: 'Entitas master tidak dikenal.' };
  const rawId = String(formData.get('__id') ?? '');
  const id = rawId ? Number(rawId) : null;
  if (rawId && (!Number.isSafeInteger(id) || !id || id < 1))
    return { error: 'ID data tidak valid.' };

  const body: Record<string, unknown> = {};
  for (const field of getEntityDef(rawEntity).fields) {
    if (field.kind === 'boolean') body[field.name] = formData.has(field.name);
    else {
      const value = String(formData.get(field.name) ?? '');
      // Kolom password kosong pada edit berarti tetap memakai password lama.
      if (field.kind !== 'password' || value) body[field.name] = value;
    }
  }

  try {
    await apiFetch(`/master/${rawEntity}${id ? `/${id}` : ''}`, {
      method: id ? 'PATCH' : 'POST',
      body: JSON.stringify(body),
    });
    refreshMaster(rawEntity);
    return { ok: true };
  } catch (error) {
    unstable_rethrow(error);
    return errorState(error);
  }
}

export async function setMasterActiveAction(
  entity: string,
  id: number,
  isActive: boolean,
): Promise<FormState> {
  if (!isMasterEntity(entity) || !Number.isSafeInteger(id) || id < 1)
    return { error: 'Data tidak valid.' };
  try {
    await apiFetch(`/master/${entity}/${id}/active`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive }),
    });
    refreshMaster(entity);
    return { ok: true };
  } catch (error) {
    unstable_rethrow(error);
    return errorState(error);
  }
}

// ─── BOM (F-03): upload Excel & penguraian ───────────────────────────────────

export interface BomImportResult {
  inserted: number;
  updated: number;
  skipped: number;
  errors: Array<{ row: number; message: string }>;
}

export async function importBomAction(
  _state: BomImportResult | { error: string } | null,
  formData: FormData,
): Promise<BomImportResult | { error: string }> {
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0)
    return { error: 'Pilih berkas Excel (.xlsx) dulu.' };
  const upload = new FormData();
  upload.set('file', file, file.name);
  try {
    const res = await apiUpload<BomImportResult>('/master/bom/import', upload);
    refreshMaster('bom');
    return res;
  } catch (error) {
    unstable_rethrow(error);
    const state = errorState(error);
    return { error: state.error ?? 'Unggahan gagal.' };
  }
}

export interface BomExplodeResult {
  root: { id: number; partNo: string; name: string; qty: number };
  onDate: string;
  lines: Array<{
    partId: number;
    partNo: string;
    name: string;
    uom: string;
    level: number;
    qty: number;
  }>;
  leaves: Array<{ partId: number; partNo: string; name: string; uom: string; qty: number }>;
}

export async function explodeBomAction(input: {
  partId: number;
  qty: number;
  onDate?: string;
}): Promise<BomExplodeResult | { error: string }> {
  const query = new URLSearchParams({ partId: String(input.partId), qty: String(input.qty) });
  if (input.onDate) query.set('onDate', input.onDate);
  try {
    return await apiFetch<BomExplodeResult>(`/master/bom/explode?${query.toString()}`);
  } catch (error) {
    unstable_rethrow(error);
    const state = errorState(error);
    return { error: state.error ?? 'Gagal mengurai BOM.' };
  }
}
