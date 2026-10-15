import type { sapOutbox } from '@ares/db';

export const SAP_GATEWAY = Symbol('SAP_GATEWAY');

export type SapGatewayResult =
  | { status: 'STAGED'; sapDocNumber?: never }
  | { status: 'POSTED'; sapDocNumber: string };

export interface SapGateway {
  readonly mode: 'fake' | 'mssql';
  readonly enabled: boolean;
  /** Harus idempoten terhadap row.idempotencyKey. */
  send(row: typeof sapOutbox.$inferSelect): Promise<SapGatewayResult>;
}

/** Gateway deterministik untuk development dan pilot tanpa SAP. */
export class FakeSapGateway implements SapGateway {
  readonly mode = 'fake' as const;
  readonly enabled = true;

  async send(row: typeof sapOutbox.$inferSelect): Promise<SapGatewayResult> {
    return { status: 'POSTED', sapDocNumber: `FAKE-${row.id}` };
  }
}

/**
 * Pembungkus jalur staging MS SQL yang sudah disiapkan sap-writer.
 * Kontrak tabel tujuan masih harus disepakati bersama tim SAP sebelum isi
 * metode ini diganti dengan insert idempoten ke database staging.
 */
export class MssqlStagingGateway implements SapGateway {
  readonly mode = 'mssql' as const;

  get enabled(): boolean {
    return process.env.SAP_MSSQL_ENABLED === 'true';
  }

  async send(row: typeof sapOutbox.$inferSelect): Promise<SapGatewayResult> {
    void row;
    throw new Error(
      'Pengiriman ke MS SQL belum diimplementasikan. ' +
        'Bentuk tabel tujuan dan movement type harus disepakati tim SAP lebih dulu.',
    );
  }
}
