import { z } from 'zod';

export interface PoSyncResult {
  month: string; preview: boolean; fetched: number; imported: number; failed: number;
  issues: Array<{ poNo: string; reason: string }>;
  rows: Array<{ poNo: string; item: string; vendorNo: string; material: string; orderedQty: number }>;
}
export interface PoSyncStatus {
  enabled: boolean; month: string; count: number; syncedAt: string | null;
  /** Tanggal (WIB) PO bulan berikutnya ditarik otomatis (F-44). */
  pullDay: number;
}
export interface PoSyncJob {
  state: string; result: PoSyncResult | null; error: string | null;
}

/** F-44: 1–28 supaya tanggalnya ada di setiap bulan. */
export const poScheduleSchema = z.object({
  day: z.coerce.number().int().min(1, 'Tanggal minimal 1').max(28, 'Tanggal maksimal 28'),
});
export type PoScheduleInput = z.infer<typeof poScheduleSchema>;

export interface MasterSyncCount { created: number; updated: number; unchanged: number }
/** Hasil tarik master supplier/part/vendor part dari staging SAP (F-01, F-02). */
export interface MasterSyncResult {
  preview: boolean;
  vendors: MasterSyncCount;
  parts: MasterSyncCount;
  vendorParts: { created: number; existing: number; skipped: number };
  issues: Array<{ key: string; reason: string }>;
}
export interface MasterSyncJob {
  state: string; result: MasterSyncResult | null; error: string | null;
}
