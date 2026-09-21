import { explodeBom, isEffective, leafRequirements, type BomLine } from './bom';
import { nextCutoff, type NextCutoffInput, type NextCutoffResult } from './cutoff';

export interface ProductionRecord {
  id: string;
  parentPartId: number;
  qty: number;
  line: string;
  occurredAt: Date;
}

export interface ConsumptionVendorPart {
  id: number;
  partId: number;
  isActive: boolean;
}

export interface ComponentConsumption {
  sourceKey: string;
  parentPartId: number;
  componentPartId: number;
  vendorPartId: number;
  qty: number;
  line: string;
  occurredAt: Date;
}

export class MissingVendorPartError extends Error {
  constructor(readonly componentPartIds: number[]) {
    super(`Komponen tidak punya vendor part aktif: ${componentPartIds.join(', ')}`);
    this.name = 'MissingVendorPartError';
  }
}

export class InvalidConsumptionQuantityError extends Error {
  constructor(readonly componentPartId: number, readonly qty: number) {
    super(`Konsumsi komponen ${componentPartId} harus berupa pcs bulat, didapat ${qty}`);
    this.name = 'InvalidConsumptionQuantityError';
  }
}

/**
 * PRD 6.7.1: satu hasil produksi menjadi konsumsi komponen daun dari versi BOM
 * yang berlaku saat produksi. SOURCE_KEY diberi komponen karena satu record MES
 * menghasilkan beberapa baris, tetapi tetap memakai prefix idempoten MES:<id>.
 */
export function consumeProduction(
  record: ProductionRecord,
  bomLines: readonly BomLine[],
  vendorParts: readonly ConsumptionVendorPart[],
): ComponentConsumption[] {
  if (!record.id.trim()) throw new Error('ID record produksi wajib diisi');
  if (!Number.isInteger(record.qty) || record.qty <= 0) throw new Error('Qty produksi harus pcs bulat positif');
  if (!Number.isFinite(record.occurredAt.getTime())) throw new Error('Waktu produksi tidak valid');

  const onDate = record.occurredAt.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
  const activeBom = bomLines.filter((line) => isEffective(line, onDate));
  const exploded = explodeBom(record.parentPartId, record.qty, activeBom, { onDate });
  const requirements = leafRequirements(exploded, activeBom);
  const activeVendorParts = new Map<number, ConsumptionVendorPart>();
  for (const vp of vendorParts) {
    if (vp.isActive && !activeVendorParts.has(vp.partId)) activeVendorParts.set(vp.partId, vp);
  }

  const missing = [...requirements.keys()].filter((partId) => !activeVendorParts.has(partId));
  if (missing.length > 0) throw new MissingVendorPartError(missing);

  return [...requirements]
    .sort(([a], [b]) => a - b)
    .map(([componentPartId, qty], index) => {
      if (!Number.isInteger(qty)) throw new InvalidConsumptionQuantityError(componentPartId, qty);
      return {
        // Baris pertama menjadi penanda unik record; baris berikutnya perlu
        // suffix karena satu record dapat menghasilkan banyak konsumsi.
        sourceKey: index === 0 ? `MES:${record.id}` : `MES:${record.id}:${componentPartId}`,
        parentPartId: record.parentPartId,
        componentPartId,
        vendorPartId: activeVendorParts.get(componentPartId)!.id,
        qty,
        line: record.line,
        occurredAt: record.occurredAt,
      };
    });
}

export interface CutoffSchedule extends Omit<NextCutoffInput, 'now' | 'holidays'> {
  id: number;
}

export interface AssignedCutoff extends NextCutoffResult {
  cutoffId: number;
}

/** F-14: pilih cutoff efektif pertama setelah waktu konsumsi. */
export function assignCutoff(
  occurredAt: Date,
  cutoffs: readonly CutoffSchedule[],
  holidays: readonly string[],
): AssignedCutoff | null {
  let selected: AssignedCutoff | null = null;
  for (const cutoff of cutoffs) {
    const result = nextCutoff({ now: occurredAt, holidays, ...cutoff });
    if (!result) continue;
    if (!selected || result.cutoffAt < selected.cutoffAt) {
      selected = { cutoffId: cutoff.id, ...result };
    }
  }
  return selected;
}
