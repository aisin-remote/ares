/**
 * PRD 6.6 (picklist dan PO) dan §3 (siklus hidup picklist & kanban).
 */
import type { KanbanStatus, PicklistStatus } from '@ares/contracts';

// ─── 6.6.1 Pemilihan PO item ────────────────────────────────────────────────

/** Baris TT_PO_LINE + header-nya, sudah disaring per vendor oleh pemanggil. */
export interface PoCandidate {
  poLineId: number;
  sapPoNo: string;
  sapPoItem: string;
  partId: number;
  openQty: number;
  /** Periode PO bulanan; null atau rentang lintas bulan tidak boleh dipakai. */
  validFrom: string | null;
  validTo: string | null;
}

export interface PoOpenQtyInput {
  /** Qty PO item hasil tarik bulanan dari SAP (F-44). */
  openQty: number;
  /**
   * Pcs yang sudah dipesan ARES pada PO item: semua Order Sheet yang tidak
   * batal, termasuk yang sudah diterima. Kekurangan kirim dihitung di Order
   * Sheet recovery-nya, bukan di order asal (keputusan 2026-11-03).
   */
  orderedPcs: number;
  /** Pcs yang hendak diterbitkan sekarang. */
  newPcs: number;
}

/** F-19: satu keputusan murni yang dipakai order manual dan cutoff otomatis. */
export function checkPoOpenQty(input: PoOpenQtyInput): {
  allowed: boolean;
  reason: 'PO_OPEN_QTY' | null;
  availablePcs: number;
  projectedPcs: number;
} {
  for (const [name, value] of Object.entries(input)) {
    if (!Number.isInteger(value) || value < 0) throw new Error(`${name} harus bilangan bulat ≥ 0`);
  }
  const availablePcs = Math.max(0, input.openQty - input.orderedPcs);
  const projectedPcs = input.orderedPcs + input.newPcs;
  const allowed = projectedPcs <= input.openQty;
  return { allowed, reason: allowed ? null : 'PO_OPEN_QTY', availablePcs, projectedPcs };
}

/** Periode bisnis PO, bukan tanggal sinkronisasi atau tanggal GR. */
export function poPeriodForDate(date: string): { validFrom: string; validTo: string } {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error('Tanggal periode PO tidak valid');
  }
  return {
    validFrom: `${date.slice(0, 7)}-01`,
    validTo: new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, 0)).toISOString().slice(0, 10),
  };
}

export function isPoValidForDelivery(period: { validFrom: string | null; validTo: string | null }, date: string): boolean {
  const month = poPeriodForDate(date);
  return period.validFrom === month.validFrom && period.validTo === month.validTo;
}

/**
 * PO item yang berlaku pada tanggal kirim untuk satu part; null = line tidak
 * boleh terbit (F-18). Default vendor part (F-02) didahulukan bila masih
 * berlaku; selain itu yang paling cepat berakhir dipakai dulu supaya PO tidak
 * kedaluwarsa dengan sisa qty.
 */
export function pickPoItem(
  candidates: readonly PoCandidate[],
  partId: number,
  deliveryDate: string,
  preferredPoLineId?: number | null,
): PoCandidate | null {
  const valid = candidates.filter((c) => c.partId === partId && c.openQty > 0 && isPoValidForDelivery(c, deliveryDate));
  const preferred =
    preferredPoLineId != null ? valid.find((c) => c.poLineId === preferredPoLineId) : undefined;
  if (preferred) return preferred;
  const byExpiry = [...valid].sort(
    (a, b) =>
      (a.validTo ?? '9999-99-99').localeCompare(b.validTo ?? '9999-99-99') ||
      a.sapPoNo.localeCompare(b.sapPoNo),
  );
  return byExpiry[0] ?? null;
}

/** Recovery mempertahankan PO asal bila masih satu periode; lintas bulan pilih PO baru. */
export function pickRecoveryPoItem(
  candidates: readonly PoCandidate[], partId: number, deliveryDate: string,
  source: { sapPoNo: string; sapPoItem: string },
): PoCandidate | null {
  const original = candidates.find((po) => po.sapPoNo === source.sapPoNo && po.sapPoItem === source.sapPoItem);
  return pickPoItem(candidates, partId, deliveryDate, original?.poLineId);
}

// ─── §3 Transisi status ─────────────────────────────────────────────────────

export const PICKLIST_TRANSITIONS: Record<PicklistStatus, readonly PicklistStatus[]> = {
  ISSUED: ['DOWNLOADED', 'CANCELLED'],
  DOWNLOADED: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['PARTIAL', 'COMPLETE'],
  PARTIAL: ['COMPLETE'],
  COMPLETE: [],
  CANCELLED: [],
};

export const KANBAN_TRANSITIONS: Record<KanbanStatus, readonly KanbanStatus[]> = {
  PRINTED: ['SHIPPED', 'RECEIVED', 'MISSING', 'CANCELLED'],
  SHIPPED: ['RECEIVED', 'MISSING'],
  MISSING: ['RECEIVED'],
  RECEIVED: [],
  CANCELLED: [],
};

type Entity = 'picklist' | 'kanban';
type StatusOf<E extends Entity> = E extends 'picklist' ? PicklistStatus : KanbanStatus;

export function canTransition<E extends Entity>(
  entity: E,
  from: StatusOf<E>,
  to: StatusOf<E>,
): boolean {
  const table = (entity === 'picklist' ? PICKLIST_TRANSITIONS : KANBAN_TRANSITIONS) as Record<
    string,
    readonly string[]
  >;
  return table[from]?.includes(to) ?? false;
}

export class InvalidTransitionError extends Error {
  constructor(entity: Entity, from: string, to: string) {
    super(`Status ${entity} ${from} tidak bisa diubah menjadi ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

export function assertTransition<E extends Entity>(
  entity: E,
  from: StatusOf<E>,
  to: StatusOf<E>,
): void {
  if (!canTransition(entity, from, to)) throw new InvalidTransitionError(entity, from, to);
}
