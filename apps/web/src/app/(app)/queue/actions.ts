'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import type { QueueAdjustmentInput, QueueHoldInput } from '@ares/contracts';
import { apiFetch, ApiRequestError } from '@/lib/api';

type Result = { ok: true } | { error: string };
const message = (error: unknown) => error instanceof ApiRequestError ? error.message : 'Tidak bisa menghubungi server.';

export async function setQueueKanbanAction(id: number, input: QueueAdjustmentInput): Promise<Result> {
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

type CutoffResult =
  | { status: 'processing' }
  | { status: 'failed' | 'blocked' | 'skipped'; error: string }
  | {
      status: 'created';
      publicId: string;
      picklistNo: string;
      lineCount: number;
      kanbanCount: number;
    };

export async function runCutoffAction(
  vendorId: number,
  cutoffAt: string,
  reason?: string,
): Promise<{ jobId?: string; error?: string }> {
  try {
    const result = await apiFetch<{ queued: true; jobId?: string }>('/cutoff/run', {
      method: 'POST',
      body: JSON.stringify({ vendorId, cutoffAt, reason: reason?.trim() || undefined }),
    });
    if (!result.jobId) return { error: 'Nomor proses cutoff tidak diterima dari server.' };
    return { jobId: result.jobId };
  } catch (error) {
    unstable_rethrow(error);
    return { error: message(error) };
  }
}

export async function getCutoffResultAction(jobId: string): Promise<CutoffResult> {
  try {
    const response = await apiFetch<{
      status: 'PROCESSING' | 'FAILED' | 'COMPLETED';
      error?: string;
      result?: {
        results: Array<{
          result:
            | {
                status: 'CREATED';
                publicId: string;
                picklistNo: string;
                lineCount: number;
                kanbanCount: number;
              }
            | { status: 'BLOCKED'; reason: string }
            | { status: 'SKIPPED'; reason: string };
        }>;
      };
    }>(`/cutoff/result/${encodeURIComponent(jobId)}`);

    if (response.status === 'PROCESSING') return { status: 'processing' };
    if (response.status === 'FAILED') {
      return { status: 'failed', error: response.error ?? 'Pembuatan Order Sheet gagal.' };
    }
    const result = response.result?.results[0]?.result;
    if (!result) return { status: 'skipped', error: 'Tidak ada antrean yang diproses.' };
    if (result.status === 'BLOCKED') return { status: 'blocked', error: result.reason };
    if (result.status === 'SKIPPED') return { status: 'skipped', error: result.reason };

    revalidatePath('/queue');
    revalidatePath('/picklist');
    return {
      status: 'created',
      publicId: result.publicId,
      picklistNo: result.picklistNo,
      lineCount: result.lineCount,
      kanbanCount: result.kanbanCount,
    };
  } catch (error) {
    unstable_rethrow(error);
    return { status: 'failed', error: message(error) };
  }
}
