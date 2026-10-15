import 'server-only';
import { apiFetch } from './api';

export interface SapSummary {
  pending: number;
  processing: number;
  staged: number;
  posted: number;
  failed: number;
  held: number;
  skipped: number;
  /** Apakah gateway yang dipilih siap mengirim. */
  pengirimanAktif: boolean;
  gateway: 'fake' | 'mssql';
}

export interface SapOutboxRow {
  id: number;
  plantCode: string | null;
  docType: string;
  movementType: string | null;
  sourceTable: string;
  sourceId: number;
  idempotencyKey: string;
  status: string;
  attempts: number;
  lastError: string | null;
  sapDocNumber: string | null;
  occurredAt: string;
  nextAttemptAt: string | null;
  lastAttemptAt: string | null;
  stagedAt: string | null;
  postedAt: string | null;
  sentAt: string | null;
}

export interface SapOutboxList {
  data: SapOutboxRow[];
  meta: { page: number; perPage: number; total: number; totalPages: number };
}

export async function getSapSummary(): Promise<SapSummary> {
  const raw = await apiFetch<Partial<SapSummary> & { sent?: number }>('/sap/summary');
  // Aman saat web sudah diperbarui tetapi proses API lama belum selesai direstart.
  return {
    pending: raw.pending ?? 0,
    processing: raw.processing ?? 0,
    staged: raw.staged ?? 0,
    posted: raw.posted ?? raw.sent ?? 0,
    failed: raw.failed ?? 0,
    held: raw.held ?? 0,
    skipped: raw.skipped ?? 0,
    pengirimanAktif: raw.pengirimanAktif ?? false,
    gateway: raw.gateway ?? 'fake',
  };
}

export async function listSapOutbox(options: {
  page?: number;
  perPage?: number;
  status?: string;
  docType?: string;
  from?: string;
  to?: string;
} = {}): Promise<SapOutboxList> {
  const params = new URLSearchParams({
    page: String(options.page ?? 1),
    perPage: String(options.perPage ?? 25),
    status: options.status ?? 'ALL',
    docType: options.docType ?? 'ALL',
  });
  if (options.from) params.set('from', options.from);
  if (options.to) params.set('to', options.to);
  const result = await apiFetch<SapOutboxList>(`/sap/outbox?${params}`);
  return {
    ...result,
    data: result.data.map((row) => ({
      ...row,
      status: row.status === 'SENT' ? 'POSTED' : row.status,
      idempotencyKey: row.idempotencyKey ?? `${row.sourceTable} #${row.sourceId}`,
      nextAttemptAt: row.nextAttemptAt ?? null,
      lastAttemptAt: row.lastAttemptAt ?? null,
      stagedAt: row.stagedAt ?? row.sentAt ?? null,
      postedAt: row.postedAt ?? row.sentAt ?? null,
    })),
  };
}
