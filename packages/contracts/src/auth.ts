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
  /** Token Google reCAPTCHA v3, dibuat saat pengguna menekan Masuk. */
  captchaToken: z.string().min(1, 'Verifikasi keamanan belum selesai, coba masuk kembali').max(8192),
});
export type LoginInput = z.infer<typeof loginSchema>;

/**
 * Ganti password karena masa berlaku 90 hari habis (lihat `passwordExpired`).
 * Dipakai tanpa sesi: bekalnya `changeToken` berumur pendek dari login.
 */
export const changePasswordSchema = z.object({
  changeToken: z.string().min(1, 'Sesi ganti password tidak ditemukan').max(2048),
  newPassword: z
    .string()
    .min(12, 'Password baru minimal 12 karakter')
    .max(72)
    .refine((value) => new TextEncoder().encode(value).length <= 72, 'Password maksimal 72 byte'),
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const loginOtpSchema = z.object({
  mfaToken: z.string().min(1, 'Sesi verifikasi tidak ditemukan').max(2048),
  otpCode: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Kode OTP harus 6 angka'),
});
export type LoginOtpInput = z.infer<typeof loginOtpSchema>;

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
      /** Token singkat yang hanya bisa dipakai bersama OTP email, bukan token sesi. */
      mfaToken: string;
      /** Alamat disamarkan agar layar dapat menjelaskan tujuan pengiriman OTP. */
      emailHint: string;
      /** Hanya dikirim API lokal/demo agar form OTP bisa terisi otomatis. */
      demoOtpCode?: string;
    }
  | {
      /** Password lewat masa berlaku; sesi baru terbit setelah diganti. */
      passwordChangeRequired: true;
      /** Token berumur pendek, hanya sah untuk POST /auth/password. */
      changeToken: string;
      maxAgeDays: number;
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
