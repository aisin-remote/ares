import { z } from 'zod';

export const productionResultSchema = z.object({
  id: z.string().trim().min(1, 'ID record wajib diisi').max(128),
  partNo: z.string().trim().min(1, 'Part jadi wajib diisi').max(64),
  qty: z.coerce.number().int().positive('Qty harus lebih dari 0'),
  line: z.string().trim().min(1, 'Line wajib diisi').max(32),
  producedAt: z.string().datetime({ offset: true, message: 'Waktu produksi harus ISO 8601' }),
});
export type ProductionResultInput = z.infer<typeof productionResultSchema>;

export const fakeProductionResultSchema = productionResultSchema;
export type FakeProductionResultInput = ProductionResultInput;

export const queueAdjustmentSchema = z.object({
  kanban: z.coerce.number().int().min(0, 'Jumlah kanban tidak boleh negatif'),
  reason: z.string().trim().min(3, 'Alasan minimal 3 karakter').max(255),
});
export type QueueAdjustmentInput = z.infer<typeof queueAdjustmentSchema>;

export const queueHoldSchema = z.object({
  hold: z.boolean(),
  reason: z.string().trim().min(3, 'Alasan minimal 3 karakter').max(255),
});
export type QueueHoldInput = z.infer<typeof queueHoldSchema>;

export const runCutoffSchema = z.object({
  vendorId: z.coerce.number().int().positive('Supplier tidak valid'),
  cutoffAt: z.string().datetime({ offset: true, message: 'Waktu cutoff harus ISO 8601' }),
  reason: z.string().trim().min(3, 'Alasan minimal 3 karakter').max(255).optional(),
});
export type RunCutoffInput = z.infer<typeof runCutoffSchema>;

export const reverseConsumptionSchema = z.object({
  reason: z.string().trim().min(3, 'Alasan minimal 3 karakter').max(255),
});
export type ReverseConsumptionInput = z.infer<typeof reverseConsumptionSchema>;
