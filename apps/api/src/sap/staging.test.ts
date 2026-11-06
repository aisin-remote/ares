import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readStagingConfig, stagingConnectionConfig } from './staging.config';
import { MssqlStagingGateway } from './sap.gateway';
import { StagingDbService } from './staging-db.service';

const mock = vi.hoisted(() => ({
  connect: vi.fn(), close: vi.fn(), on: vi.fn(), create: vi.fn(),
}));
vi.mock('mssql', () => ({
  ConnectionPool: class {
    connected = false;
    constructor(config: unknown) { mock.create(config); }
    on(...args: unknown[]) { mock.on(...args); return this; }
    async connect() { await mock.connect(); this.connected = true; return this; }
    async close() { this.connected = false; await mock.close(); }
  },
}));

const env = {
  STAGING_HOST: 'sql-test', STAGING_DATABASE: 'staging-test',
  STAGING_USER: 'test', STAGING_PASSWORD: 'password-only-for-test',
  STAGING_PORT: '1433', STAGING_PUSH_ENABLED: 'false', STAGING_PULL_ENABLED: 'false',
};

afterEach(() => vi.unstubAllEnvs());

describe('konfigurasi staging ARES', () => {
  it('false tidak berubah menjadi true; named instance tidak memakai port tetap', () => {
    expect(readStagingConfig(env)).toMatchObject({ STAGING_PUSH_ENABLED: false, STAGING_PULL_ENABLED: false });
    expect(stagingConnectionConfig(env)).toMatchObject({ server: 'sql-test', port: 1433 });
    const named = stagingConnectionConfig({ ...env, STAGING_INSTANCE: 'SAP' });
    expect(named.port).toBeUndefined();
    expect(named.options?.instanceName).toBe('SAP');
  });

  it('memakai SQL Server Authentication secara eksplisit dan mempertahankan password apa adanya', () => {
    const password = 'Only-for-test!$2026;"';
    const config = stagingConnectionConfig({ ...env, STAGING_PASSWORD: password });
    expect(config.authentication).toEqual({
      type: 'default', options: { userName: 'test', password },
    });
    expect(config.domain).toBeUndefined();
  });

  it('menolak port/flag salah dan konfigurasi belum lengkap tanpa menampilkan password', () => {
    expect(() => stagingConnectionConfig({ ...env, STAGING_PORT: '70000' })).toThrow('STAGING_PORT');
    expect(() => readStagingConfig({ ...env, STAGING_PUSH_ENABLED: 'typo' })).toThrow('STAGING_PUSH_ENABLED');
    expect(() => stagingConnectionConfig({ ...env, STAGING_HOST: '' })).toThrow('STAGING_HOST');
    expect(() => readStagingConfig({ ...env, STAGING_PORT: 'invalid' })).not.toThrow(env.STAGING_PASSWORD);
  });

  it('flag lama tidak dapat mengaktifkan pengiriman saat push false', async () => {
    vi.stubEnv('STAGING_PUSH_ENABLED', 'false');
    vi.stubEnv('SAP_MSSQL_ENABLED', 'true');
    const gateway = new MssqlStagingGateway();
    expect(gateway.enabled).toBe(false);
    await expect(gateway.send({} as Parameters<typeof gateway.send>[0])).rejects.toThrow('dinonaktifkan');
    expect(mock.create).not.toHaveBeenCalled();
  });
});

describe('koneksi staging lazy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  });

  it('tidak menyambung saat dibuat; panggilan bersamaan berbagi satu pool dan ditutup saat selesai', async () => {
    const db = new StagingDbService();
    expect(mock.create).not.toHaveBeenCalled();
    const [first, second] = await Promise.all([db.connect(), db.connect()]);
    expect(first).toBe(second);
    expect(mock.create).toHaveBeenCalledTimes(1);
    expect(await db.connect()).toBe(first);
    expect(mock.on).toHaveBeenCalledWith('error', expect.any(Function));
    await db.onModuleDestroy();
    expect(mock.close).toHaveBeenCalledTimes(1);
  });

  it('koneksi gagal ditutup, password tidak bocor, dan percobaan berikutnya bisa berhasil', async () => {
    mock.connect.mockRejectedValueOnce(Object.assign(new Error(env.STAGING_PASSWORD), { code: 'ELOGIN' }));
    const db = new StagingDbService();
    await expect(db.connect()).rejects.toThrow('ELOGIN');
    expect(mock.close).toHaveBeenCalledTimes(1);
    expect((await db.connect()).connected).toBe(true);
    expect(mock.create).toHaveBeenCalledTimes(2);
    await db.onModuleDestroy();
  });
});
