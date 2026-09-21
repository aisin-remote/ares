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
  API_PORT: z.coerce.number().int().default(3001),
  TZ: z.string().default('Asia/Jakarta'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL wajib diisi'),
  REDIS_URL: z.string().min(1, 'REDIS_URL wajib diisi'),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET minimal 16 karakter'),
  JWT_EXPIRES_IN: z.string().default('8h'),
  DEVICE_JWT_EXPIRES_IN: z.string().default('365d'),

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
