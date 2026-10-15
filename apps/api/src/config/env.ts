import { z } from 'zod';

/**
 * Boolean dari environment variable.
 *
 * JANGAN memakai `z.coerce.boolean()` untuk ini: fungsi itu memakai aturan
 * truthy JavaScript, sehingga string "false" — dan juga "0" — menghasilkan
 * `true`. Efeknya diperparah oleh @nestjs/config yang menulis hasil validasi
 * kembali ke `process.env`, jadi MQTT_ENABLED=false berubah menjadi "true"
 * dan servis yang seharusnya mati justru menyala.
 */
const envBoolean = (bawaan: boolean) =>
  z
    .union([z.boolean(), z.string()])
    .default(bawaan)
    .transform((v) => {
      if (typeof v === 'boolean') return v;
      return ['true', '1', 'yes', 'y', 'on'].includes(v.trim().toLowerCase());
    });

/**
 * Konfigurasi divalidasi saat proses start, bukan saat dipakai.
 *
 * Kalau ada yang salah, API gagal start dengan pesan jelas — bukan meledak
 * jam 2 pagi saat worker pertama kali menyentuh variabel yang kosong.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().ip().default('127.0.0.1'),
  API_PORT: z.coerce.number().int().default(3001),
  TZ: z.string().default('Asia/Jakarta'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL wajib diisi'),
  REDIS_URL: z.string().min(1, 'REDIS_URL wajib diisi'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET minimal 32 karakter'),
  JWT_EXPIRES_IN: z.string().default('8h'),
  DEVICE_JWT_EXPIRES_IN: z.string().default('365d'),
  JWT_ISSUER: z.string().min(1).default('ares-api'),
  JWT_AUDIENCE: z.string().min(1).default('ares-clients'),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  API_BODY_LIMIT: z.string().regex(/^\d+(?:kb|mb)$/i).default('256kb'),
  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(14).default(12),
  // Kunci AES untuk secret Google Authenticator. Dev boleh fallback ke JWT_SECRET.
  TOTP_ENCRYPTION_KEY: z.preprocess(
    (value) => value === '' ? undefined : value,
    z.string().min(32).optional(),
  ),

  // PRD 8.2: API aplikasi produksi (MES) yang ditarik job mes-sync.
  MES_API_URL: z.string().optional(),
  MES_API_TOKEN: z.string().optional(),
  MES_GATEWAY: z.enum(['fake', 'http']).default('fake'),
  MES_SYNC_ENABLED: envBoolean(false),
  MES_SYNC_INTERVAL_SEC: z.coerce.number().int().positive().default(120),

  // F-16: evaluasi antrean yang sudah mencapai cutoff dan terbitkan picklist.
  CUTOFF_ENABLED: envBoolean(true),
  CUTOFF_INTERVAL_SEC: z.coerce.number().int().positive().default(60),
  CUTOFF_SYSTEM_USER_NPK: z.string().min(1).default('ADMIN'),

  WEB_ORIGIN: z.string().default('http://127.0.0.1:3000'),

  // PRD 8.4 / F-31: email ke akun supplier. SMTP_HOST kosong = tulis ke log saja.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_SECURE: envBoolean(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default('ARES e-Kanban <no-reply@ares.local>'),

  /** Storage location tujuan GR & stok WH (PRD 8.1, §13); `WH00` hanya placeholder. */
  SAP_SLOC: z.string().default('WH00'),
  /** Implementasi tujuan sap-writer. Fake dipakai di development/pilot tanpa SAP. */
  SAP_GATEWAY: z.enum(['fake', 'mssql']).default('fake'),

  /** Tempat PDF picklist & kanban disimpan worker (F-27); relatif ke cwd proses. */
  STORAGE_DIR: z.string().default('./storage'),
}).superRefine((env, ctx) => {
  const origins = env.WEB_ORIGIN.split(',').map((value) => value.trim()).filter(Boolean);
  if (origins.length === 0 || origins.some((origin) => {
    try { return new URL(origin).origin !== origin || origin.includes('*'); }
    catch { return true; }
  })) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['WEB_ORIGIN'], message: 'WEB_ORIGIN harus daftar origin URL tanpa wildcard' });
  }
  if (env.NODE_ENV !== 'production') return;
  if (env.JWT_SECRET.length < 48 || env.JWT_SECRET.includes('ganti-dengan-rahasia')) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['JWT_SECRET'], message: 'Produksi membutuhkan secret acak minimal 48 karakter' });
  }
  if (!env.TOTP_ENCRYPTION_KEY || env.TOTP_ENCRYPTION_KEY.length < 48) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['TOTP_ENCRYPTION_KEY'], message: 'Produksi membutuhkan TOTP_ENCRYPTION_KEY acak minimal 48 karakter' });
  }
  if (origins.some((origin) => !origin.startsWith('https://'))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['WEB_ORIGIN'], message: 'Produksi wajib memakai origin HTTPS' });
  }
  if (env.API_HOST !== '127.0.0.1' && env.API_HOST !== '::1') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['API_HOST'], message: 'Produksi VPS harus mengikat API ke loopback' });
  }
  if (env.TRUST_PROXY_HOPS < 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['TRUST_PROXY_HOPS'], message: 'Produksi wajib berada di belakang reverse proxy tepercaya' });
  }
  if (env.MES_GATEWAY === 'http') {
    let secureMesUrl = false;
    try { secureMesUrl = new URL(env.MES_API_URL ?? '').protocol === 'https:'; }
    catch { secureMesUrl = false; }
    if (!secureMesUrl) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['MES_API_URL'], message: 'MES_GATEWAY=http di produksi wajib memakai URL HTTPS' });
    }
    if (!env.MES_API_TOKEN || env.MES_API_TOKEN.length < 32) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['MES_API_TOKEN'], message: 'Token MES produksi minimal 32 karakter' });
    }
  }
  if (env.SMTP_USER && !env.SMTP_PASS) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['SMTP_PASS'], message: 'SMTP_PASS wajib bila SMTP_USER diisi' });
  }
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Konfigurasi environment tidak valid:\n${detail}`);
  }
  return parsed.data;
}

export const ENV = Symbol('ENV');
