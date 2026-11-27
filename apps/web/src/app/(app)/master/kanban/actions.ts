'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import type { SaveSapKanbanInput, SaveSapKanbanResult } from '@ares/contracts';
import { apiFetch, ApiRequestError } from '@/lib/api';

export async function saveSapKanbanAction(input: SaveSapKanbanInput) {
  try {
    const result = await apiFetch<SaveSapKanbanResult>('/sap/kanban', {
      method: 'PUT', body: JSON.stringify(input),
    });
    revalidatePath('/master/kanban');
    revalidatePath('/master/vendorParts');
    revalidatePath('/picklist/baru');
    return result;
  } catch (error) {
    unstable_rethrow(error);
    return { error: error instanceof ApiRequestError ? error.message : 'Sistem tidak dapat dihubungi. Muat ulang daftar sebelum mencoba kembali.' };
  }
}
