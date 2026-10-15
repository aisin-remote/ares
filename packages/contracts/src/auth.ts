import { z } from 'zod';

export const loginSchema = z.object({
  /**
   * Identitas login: NPK untuk akun internal, email untuk akun supplier
   * (PRD §10.2 memberi label berbeda di layar, bukan halaman login berbeda).
   */
  npk: z.string().trim().min(1, 'NPK atau email wajib diisi').max(191),
  password: z
    .string()
    .min(1, 'Password wajib diisi')
    .max(72)
    .refine((value) => new TextEncoder().encode(value).length <= 72, 'Password maksimal 72 byte'),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const loginTotpSchema = z.object({
  mfaToken: z.string().min(1, 'Sesi verifikasi tidak ditemukan').max(2048),
  totpCode: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Kode Authenticator harus 6 angka'),
});
export type LoginTotpInput = z.infer<typeof loginTotpSchema>;

const passwordSchema = z
  .string()
  .min(15, 'Password minimal 15 karakter')
  .max(72)
  .refine((value) => new TextEncoder().encode(value).length <= 72, 'Password maksimal 72 byte');

/** Tahap pertama pendaftaran mandiri supplier: buat enrollment Google Authenticator. */
export const supplierRegistrationRequestSchema = z.object({
  vendorCode: z.string().trim().min(1, 'Kode supplier wajib diisi').max(32),
  name: z.string().trim().min(2, 'Nama minimal 2 karakter').max(128),
  email: z.string().trim().toLowerCase().email('Email tidak valid').max(191),
});
export type SupplierRegistrationRequestInput = z.infer<typeof supplierRegistrationRequestSchema>;

export const supplierRegistrationVerifySchema = z.object({
  challengeId: z.string().uuid('Sesi Authenticator tidak valid'),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Kode Authenticator harus 6 angka'),
  password: passwordSchema,
});
export type SupplierRegistrationVerifyInput = z.infer<typeof supplierRegistrationVerifySchema>;

export interface SupplierRegistrationRequestResponse {
  challengeId: string;
  qrDataUrl: string;
  setupKey: string;
  message: string;
}

export interface SupplierRegistrationVerifyResponse {
  status: 'PENDING_APPROVAL';
  message: string;
}

export const loginResponseSchema = z.object({
  accessToken: z.string(),
  user: z.object({
    id: z.number(),
    npk: z.string(),
    name: z.string(),
    role: z.string().nullable(),
    plantId: z.number().nullable(),
    /** Terisi untuk akun supplier; menentukan scope seluruh data portal. */
    vendorId: z.number().nullable(),
  }),
});
export type LoginResponse = z.infer<typeof loginResponseSchema>;

export type LoginAttemptResponse =
  | LoginResponse
  | {
      mfaRequired: true;
      /** Token singkat yang hanya bisa dipakai bersama kode TOTP, bukan token sesi. */
      mfaToken: string;
    };

/** Login terminal/scanner — pakai token device, bukan akun manusia. */
export const deviceLoginSchema = z.object({
  deviceCode: z.string().trim().min(1).max(64),
  token: z
    .string()
    .min(1)
    .max(72)
    .refine((value) => new TextEncoder().encode(value).length <= 72, 'Token maksimal 72 byte'),
});
export type DeviceLoginInput = z.infer<typeof deviceLoginSchema>;

export const deviceLoginResponseSchema = z.object({
  accessToken: z.string(),
  device: z.object({
    code: z.string(),
    name: z.string(),
    kind: z.enum(['SCANNER', 'RFID', 'MACHINE_PANEL', 'PRINTER']),
  }),
});
export type DeviceLoginResponse = z.infer<typeof deviceLoginResponseSchema>;

export const authSessionResponseSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('user'),
    sub: z.number(),
    npk: z.string(),
    name: z.string(),
    role: z.string().nullable(),
    plantId: z.number().nullable(),
    vendorId: z.number().nullable(),
    permissions: z.array(z.string()),
  }),
  z.object({
    kind: z.literal('device'),
    sub: z.number(),
    code: z.string(),
    name: z.string(),
    deviceKind: z.enum(['SCANNER', 'RFID', 'MACHINE_PANEL', 'PRINTER']),
    plantId: z.number().nullable(),
  }),
]);
export type AuthSessionResponse = z.infer<typeof authSessionResponseSchema>;
