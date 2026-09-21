'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import type { QueueAdjustmentInput, QueueHoldInput } from '@ares/contracts';
import { apiFetch, ApiRequestError } from '@/lib/api';

type Result = { ok: true } | { error: string };
const message = (error: unknown) => error instanceof ApiRequestError ? error.message : 'Tidak bisa menghubungi server.';

export async function adjustQueueAction(id: number, input: QueueAdjustmentInput): Promise<Result> {
  try {
    await apiFetch(`/order-queues/${id}/adjust`, { method: 'POST', body: JSON.stringify(input) });
    revalidatePath('/queue');
    return { ok: true };
  } catch (error) {
    unstable_rethrow(error);
    return { error: message(error) };
  }
}

export async function setQueueHoldAction(id: number, input: QueueHoldInput): Promise<Result> {
  try {
    await apiFetch(`/order-queues/${id}/hold`, { method: 'POST', body: JSON.stringify(input) });
    revalidatePath('/queue');
    return { ok: true };
  } catch (error) {
    unstable_rethrow(error);
    return { error: message(error) };
  }
}

export async function reverseConsumptionAction(id: number, reason: string): Promise<Result> {
  try {
    await apiFetch(`/consumption/${id}/reverse`, { method: 'POST', body: JSON.stringify({ reason }) });
    revalidatePath('/consumption');
    revalidatePath('/queue');
    revalidatePath('/stock');
    return { ok: true };
  } catch (error) {
    unstable_rethrow(error);
    return { error: message(error) };
  }
}

export async function runCutoffAction(): Promise<{ ok?: string; error?: string }> {
  try {
    await apiFetch('/cutoff/run', { method: 'POST' });
    revalidatePath('/queue');
    revalidatePath('/picklist');
    return { ok: 'Proses cutoff dimasukkan ke antrean kerja.' };
  } catch (error) {
    unstable_rethrow(error);
    return { error: message(error) };
  }
}
