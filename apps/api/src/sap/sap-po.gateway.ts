import { Injectable } from '@nestjs/common';
import { VarChar } from 'mssql';
import type { SapPoRow } from '@ares/domain';
import { StagingDbService } from './staging-db.service';

/** Gateway baca saja: worker tidak pernah mengubah tabel SAP saat menarik PO. */
@Injectable()
export class SapPoGateway {
  constructor(private readonly staging: StagingDbService) {}

  /** PO yang CHR_CREATE_DATE-nya jatuh di bulan `month` (YYYY-MM). */
  async readMonth(month: string): Promise<SapPoRow[]> {
    const pool = await this.staging.connect();
    const result = await pool.request().input('month', VarChar(6), month.replace('-', '')).query<SapPoRow>(`
      SELECT TOP (10001)
        h.CHR_PO_NO AS poNo, h.CHR_SUPPLIER_ID AS vendorNo, h.CHR_CREATE_DATE AS createdDate,
        h.CHR_STATUS AS status, h.CHR_DEL_FLAG AS headerDeleted, h.CHR_CLOSE_FLAG AS closed,
        h.CHR_ERROR_FLAG AS error, l.CHR_PO_LINENO AS item, l.CHR_PART_NO AS material,
        l.CHR_QTY AS quantity, l.CHR_UNIT AS uom, l.CHR_PLANT_NO AS plant, l.CHR_DEL_FLAG AS lineDeleted
      FROM dbo.TT_PO_HEADER h
      LEFT JOIN dbo.TT_PO_LINE l ON l.CHR_PO_NO = h.CHR_PO_NO
      WHERE LEFT(LTRIM(RTRIM(h.CHR_CREATE_DATE)), 6) = @month
      ORDER BY h.CHR_PO_NO, l.CHR_PO_LINENO
    `);
    // Jangan menerapkan snapshot terpotong. Tambahkan paging bila volume pilot melewati batas ini.
    if (result.recordset.length > 10000) throw new Error('PO bulan ini melebihi 10.000 item; sinkronisasi belum diterapkan');
    return result.recordset;
  }
}
