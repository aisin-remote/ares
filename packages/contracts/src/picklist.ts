import { z } from 'zod';
import { idSchema, paginationSchema } from './common';
import { PICKLIST_STATUSES } from './status';

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal YYYY-MM-DD');

/** F-17: order manual oleh PPIC → picklist MANUAL yang terbit sendiri. */
export const issueManualPicklistSchema = z.object({
  vendorId: idSchema,
  deliveryDate: dateSchema,
  /** Cutoff/cycle yang dipilih; kosong = cutoff aktif pertama supplier. */
  cutoffId: idSchema.optional(),
  lines: z
    .array(
      z.object({
        vendorPartId: idSchema,
        boxes: z.number().int().min(1, 'Minimal 1 box'),
      }),
    )
    .min(1, 'Minimal satu baris')
    .refine((ls) => new Set(ls.map((l) => l.vendorPartId)).size === ls.length, 'Vendor part tidak boleh ganda'),
  note: z.string().trim().max(255).optional(),
});
export type IssueManualPicklistInput = z.infer<typeof issueManualPicklistSchema>;

/** F-20: pembatalan oleh PPIC, alasan tercatat. */
export const cancelPicklistSchema = z.object({
  reason: z.string().trim().min(1, 'Alasan wajib diisi').max(255),
});
export type CancelPicklistInput = z.infer<typeof cancelPicklistSchema>;

export const picklistListQuerySchema = paginationSchema.extend({
  status: z.enum(PICKLIST_STATUSES).optional(),
  vendorId: idSchema.optional(),
});
export type PicklistListQuery = z.infer<typeof picklistListQuerySchema>;

/** F-30 / 6.3: konfirmasi kirim supplier — box dikirim per line, ETA, kendaraan, catatan. */
export const confirmShipmentSchema = z.object({
  lines: z
    .array(
      z.object({
        picklistLineId: idSchema,
        boxShipped: z.number().int().min(0, 'Tidak boleh negatif'),
      }),
    )
    .min(1, 'Minimal satu baris'),
  /** ISO 8601 dengan zona (mis. hasil `Date.toISOString()`); kosong = tidak diisi. */
  eta: z.string().datetime({ offset: true }).optional(),
  vehicleNo: z.string().trim().max(32).optional(),
  note: z.string().trim().max(255).optional(),
});
export type ConfirmShipmentInput = z.infer<typeof confirmShipmentSchema>;

/** 6.3.4: koreksi jumlah kirim oleh PPIC sebelum sesi receiving dibuka. */
export const overrideShipmentSchema = z.object({
  lines: z
    .array(
      z.object({
        picklistLineId: idSchema,
        boxShipped: z.number().int().min(0, 'Tidak boleh negatif'),
      }),
    )
    .min(1, 'Minimal satu baris')
    .refine((lines) => new Set(lines.map((line) => line.picklistLineId)).size === lines.length,
      'Line Order Sheet tidak boleh ganda'),
  reason: z.string().trim().min(1, 'Alasan wajib diisi').max(255),
});
export type OverrideShipmentInput = z.infer<typeof overrideShipmentSchema>;
