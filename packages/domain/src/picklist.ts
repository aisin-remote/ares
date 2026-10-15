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
  /** YYYY-MM-DD; null = tidak dibatasi. */
  validFrom: string | null;
  validTo: string | null;
}

export interface PoOpenQtyInput {
  openQty: number;
  /** Total pcs aktif pada PO item dikurangi pcs yang sudah diterima. */
  outstandingPcs: number;
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
  const availablePcs = Math.max(0, input.openQty - input.outstandingPcs);
  const projectedPcs = input.outstandingPcs + input.newPcs;
  const allowed = projectedPcs <= input.openQty;
  return { allowed, reason: allowed ? null : 'PO_OPEN_QTY', availablePcs, projectedPcs };
}

function isValidOn(c: PoCandidate, date: string): boolean {
  if (c.validFrom && date < c.validFrom) return false;
  if (c.validTo && date > c.validTo) return false;
  return c.openQty > 0;
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
  const valid = candidates.filter((c) => c.partId === partId && isValidOn(c, deliveryDate));
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

// ─── Cycle: kedatangan ke-n dalam satu hari (§14) ───────────────────────────

/** Satu baris TM_VENDOR_CUTOFF aktif milik supplier; jam pabrik 'HH:MM:SS'. */
export interface CutoffSlot {
  id: number;
  cutoffTime: string;
  /** Jam truk tiba di gudang - inilah yang menentukan urutan cycle. */
  arrivalTime: string;
}

/**
 * Cycle = kedatangan ke-n dalam satu hari (§14), jadi yang diurutkan adalah
 * jam kedatangan, bukan jam cutoff.
 *
 * Keduanya sering berlawanan: cutoff sore biasanya dikirim semalam dan tiba
 * paling pagi keesokan harinya, sedangkan cutoff pagi baru tiba siang.
 * Mengurutkan jam cutoff membuat truk pertama membawa kartu "cycle 2".
 *
 * LEAD_DAYS sengaja tidak ikut mengurutkan: ia menentukan truk datang di hari
 * yang mana, bukan urutannya di dalam satu hari.
 *
 * Nilainya di-snapshot ke picklist saat terbit dan tidak pernah dihitung ulang
 * saat cetak ulang (F-26): PPIC boleh menambah atau menghapus jadwal cutoff,
 * tetapi kartu yang sudah beredar di supplier harus tetap menyebut cycle yang
 * sama. Mengembalikan null bila cutoff-nya tidak ada di daftar.
 */
export function cycleOfCutoff(cutoffs: readonly CutoffSlot[], cutoffId: number): number | null {
  const urut = [...cutoffs].sort(
    (a, b) =>
      a.arrivalTime.localeCompare(b.arrivalTime) ||
      a.cutoffTime.localeCompare(b.cutoffTime) ||
      a.id - b.id,
  );
  const i = urut.findIndex((c) => c.id === cutoffId);
  return i < 0 ? null : i + 1;
}
