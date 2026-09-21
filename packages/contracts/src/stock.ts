import { z } from 'zod';
import { idSchema } from './common';

/** F-42: penyesuaian stok WH manual — alasan wajib, tercatat di audit. */
export const stockAdjustSchema = z.object({
  partId: idSchema,
  /** Boleh negatif; nol ditolak — bukan penyesuaian. */
  deltaPcs: z
    .number()
    .int('Harus bilangan bulat')
    .refine((n) => n !== 0, 'Selisih tidak boleh 0'),
  reason: z.string().trim().min(3, 'Alasan wajib diisi').max(255),
  /** Kosong = sloc bawaan (SAP_SLOC). */
  sloc: z.string().trim().max(16).optional(),
});
export type StockAdjustInput = z.infer<typeof stockAdjustSchema>;
