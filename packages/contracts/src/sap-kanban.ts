import { z } from 'zod';

export const saveSapKanbanSchema = z.object({
  kanbanId: z.number().int().positive().nullable(),
  supplierId: z.string().trim().min(1).max(10),
  material: z.string().trim().min(1).max(18),
  qty: z.number().int('Qty harus angka bulat').min(1, 'Qty minimal 1').max(2_147_483_647),
  expectedQty: z.number().int().min(-2_147_483_648).max(2_147_483_647).nullable(),
}).strict();
export type SaveSapKanbanInput = z.infer<typeof saveSapKanbanSchema>;

export interface SapKanbanMasterRow {
  kanbanId: number | null;
  supplierId: string;
  supplierName: string | null;
  material: string;
  partNo: string;
  partName: string | null;
  uom: string | null;
  backNo: string | null;
  plant: string | null;
  slocTo: string | null;
  locations: string | null;
  boxType: string | null;
  rack: string | null;
  qty: number | null;
  blockedReason: string | null;
}
export interface SapKanbanMasterList {
  rows: SapKanbanMasterRow[];
  page: number;
  total: number;
  totalPages: number;
}
export interface SaveSapKanbanResult {
  kanbanId: number;
  qty: number;
  localUpdated: boolean;
}
