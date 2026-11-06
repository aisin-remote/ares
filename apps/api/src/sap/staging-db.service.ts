import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ConnectionPool } from 'mssql';
import { stagingConnectionConfig } from './staging.config';

/** Pola Avicenna MES: koneksi dibuka saat diperlukan, bukan saat API mulai. */
@Injectable()
export class StagingDbService implements OnModuleDestroy {
  private readonly logger = new Logger(StagingDbService.name);
  private pool?: ConnectionPool;
  private connecting?: Promise<ConnectionPool>;

  async connect(): Promise<ConnectionPool> {
    if (this.pool?.connected) return this.pool;
    if (this.connecting) return this.connecting;
    this.connecting = this.open();
    try {
      return await this.connecting;
    } finally {
      this.connecting = undefined;
    }
  }

  private async open(): Promise<ConnectionPool> {
    await this.pool?.close().catch(() => undefined);
    this.pool = undefined;
    const pool = new ConnectionPool(stagingConnectionConfig());
    // Event error tanpa listener dapat menjatuhkan seluruh API.
    pool.on('error', () => this.logger.warn('Koneksi staging terputus; periksa jaringan SQL Server.'));
    try {
      await pool.connect();
      this.pool = pool;
      return pool;
    } catch (error) {
      await pool.close().catch(() => undefined);
      // Jangan meneruskan connection config/kredensial ke log atau respons.
      const code = (error as { code?: string }).code;
      throw new Error(`Koneksi staging gagal (${code ?? 'UNKNOWN'}). Periksa jaringan, database, dan kredensial.`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.connecting?.catch(() => undefined);
    await this.pool?.close();
    this.pool = undefined;
  }
}
