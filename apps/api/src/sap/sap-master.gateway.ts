import { Injectable } from '@nestjs/common';
import type { SapKanbanRow, SapPartRow, SapVendorPartRow, SapVendorRow } from '@ares/domain';
import { StagingDbService } from './staging-db.service';

const LIMIT = 50000;

/** Gateway baca saja ke master staging SAP (F-01, F-02); tidak pernah menulis ke A_DB_STG. */
@Injectable()
export class SapMasterGateway {
  constructor(private readonly staging: StagingDbService) {}

  async read(): Promise<{
    vendors: SapVendorRow[]; parts: SapPartRow[]; vendorParts: SapVendorPartRow[]; kanbans: SapKanbanRow[];
  }> {
    const pool = await this.staging.connect();
    const query = async <T>(sql: string): Promise<T[]> => {
      const rows = (await pool.request().query<T>(sql)).recordset;
      // Snapshot terpotong tidak boleh diterapkan; tambahkan paging bila volume melewati batas ini.
      if (rows.length > LIMIT) throw new Error(`Master staging melebihi ${LIMIT} baris; sinkronisasi belum diterapkan`);
      return rows;
    };
    const [vendors, parts, vendorParts, kanbans] = await Promise.all([
      query<SapVendorRow>(`SELECT TOP (${LIMIT + 1}) CHR_SUPPLIER_ID AS supplierId, CHR_SUPPLIER_NAME AS name,
        CHR_SUPPLIER_ADDR AS address, CHR_DEL_FLAG AS deleted FROM dbo.TM_VENDOR`),
      query<SapPartRow>(`SELECT TOP (${LIMIT + 1}) CHR_PART_NO AS material, CHR_PART_NAME AS name, CHR_PART_UOM AS uom,
        CHR_PART_NO_DASH AS partNoDash, CHR_BACK_NO AS backNo, CHR_BOX_TYPE AS boxType,
        INT_QTY_PER_BOX AS qtyPerBox, CHR_FLAG_DELETE AS deleted FROM dbo.TM_PARTS`),
      query<SapVendorPartRow>(`SELECT TOP (${LIMIT + 1}) CHR_SUPPLIER_ID AS supplierId, CHR_PART_NO AS material
        FROM dbo.TM_VENDOR_PARTS`),
      query<SapKanbanRow>(`SELECT TOP (${LIMIT + 1}) CHR_PART_NO AS material, CHR_WC_VENDOR AS wcVendor,
        CHR_BACK_NO AS backNo, CHR_BOX_TYPE AS boxType, INT_QTY_PER_BOX AS qtyPerBox, CHR_RAKNO AS rack,
        CHR_FLAG_DELETE AS deleted FROM dbo.TM_KANBAN`),
    ]);
    return { vendors, parts, vendorParts, kanbans };
  }
}
