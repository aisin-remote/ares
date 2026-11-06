import type { config as MssqlConfig } from 'mssql';
import { z } from 'zod';

const flag = (fallback: boolean) => z.preprocess(
  (value) => typeof value === 'string' ? value.trim().toLowerCase() : value,
  z.union([z.boolean(), z.enum(['true', 'false', '1', '0', 'yes', 'no', 'on', 'off'])])
    .default(fallback)
    .transform((value) => typeof value === 'boolean' ? value : ['true', '1', 'yes', 'on'].includes(value)),
);

/** Nama setting mengikuti Avicenna MES; push/pull tetap terpisah. */
export const stagingEnvSchema = z.object({
  STAGING_HOST: z.string().trim().default(''),
  STAGING_PORT: z.preprocess(
    (value) => value === '' ? undefined : value,
    z.coerce.number().int().min(1).max(65535).default(1433),
  ),
  STAGING_INSTANCE: z.string().trim().default(''),
  STAGING_DATABASE: z.string().trim().default(''),
  STAGING_USER: z.string().trim().default(''),
  STAGING_PASSWORD: z.string().default(''),
  STAGING_ENCRYPT: flag(false),
  STAGING_TRUST_CERT: flag(true),
  STAGING_PUSH_ENABLED: flag(false),
  STAGING_PULL_ENABLED: flag(false),
});

export function readStagingConfig(env: NodeJS.ProcessEnv = process.env) {
  const result = stagingEnvSchema.safeParse(env);
  if (!result.success) {
    throw new Error(`Konfigurasi staging tidak valid: ${result.error.issues.map((issue) => issue.path.join('.')).join(', ')}`);
  }
  return result.data;
}

export function stagingConnectionConfig(env: NodeJS.ProcessEnv = process.env): MssqlConfig {
  const config = readStagingConfig(env);
  const missing = (['STAGING_HOST', 'STAGING_DATABASE', 'STAGING_USER', 'STAGING_PASSWORD'] as const)
    .filter((key) => !config[key]);
  if (missing.length) throw new Error(`Koneksi staging belum lengkap: ${missing.join(', ')}`);

  return {
    server: config.STAGING_HOST,
    // Named instance memakai SQL Browser; jangan sekaligus mengirim port tetap.
    ...(config.STAGING_INSTANCE ? {} : { port: config.STAGING_PORT }),
    database: config.STAGING_DATABASE,
    // `default` pada Tedious berarti SQL Server Authentication (user/password).
    authentication: {
      type: 'default',
      options: { userName: config.STAGING_USER, password: config.STAGING_PASSWORD },
    },
    connectionTimeout: 15_000,
    requestTimeout: 30_000,
    pool: { max: 4, min: 0, idleTimeoutMillis: 30_000 },
    options: {
      ...(config.STAGING_INSTANCE ? { instanceName: config.STAGING_INSTANCE } : {}),
      encrypt: config.STAGING_ENCRYPT,
      trustServerCertificate: config.STAGING_TRUST_CERT,
      useUTC: false,
      enableArithAbort: true,
    },
  };
}
