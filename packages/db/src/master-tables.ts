import type { MasterEntity } from '@ares/contracts';
import { bomLines, holidays, parts, users, vendorCutoffs, vendorParts, vendors } from './schema/index';

/** Satu pemetaan registry ke tabel untuk API dan pembacaan Server Component. */
export const MASTER_TABLES = {
  vendors,
  parts,
  vendorParts,
  vendorCutoffs,
  holidays,
  users,
  bom: bomLines,
} satisfies Record<MasterEntity, unknown>;

export function getMasterTable(entity: MasterEntity) {
  return MASTER_TABLES[entity];
}
