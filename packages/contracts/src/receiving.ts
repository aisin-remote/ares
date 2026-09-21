import { z } from 'zod';

const scanCode = z.string().trim().min(1, 'Kode wajib diisi').max(64);

/** F-34: buka sesi dengan barcode picklist `ARES:P:<NO>-<REV>`. */
export const openReceiptSchema = z.object({
  code: scanCode,
});
export type OpenReceiptInput = z.infer<typeof openReceiptSchema>;

/** F-36/F-38: satu scan kanban; `clientRef` dikembalikan apa adanya untuk mencocokkan balasan di stasiun. */
export const scanReceiptSchema = z.object({
  code: scanCode,
  clientRef: z.string().trim().max(64).optional(),
});
export type ScanReceiptInput = z.infer<typeof scanReceiptSchema>;

/** F-37: alasan wajib bila ada kanban kurang — dicek domain (6.5.2), bukan di sini. */
export const closeReceiptSchema = z.object({
  reason: z.string().trim().max(255).optional(),
});
export type CloseReceiptInput = z.infer<typeof closeReceiptSchema>;

/** F-40: alasan pembatalan wajib agar audit dapat menjelaskan koreksi stok. */
export const cancelReceiptSchema = z.object({
  reason: z.string().trim().min(1, 'Alasan pembatalan wajib diisi').max(255),
});
export type CancelReceiptInput = z.infer<typeof cancelReceiptSchema>;
