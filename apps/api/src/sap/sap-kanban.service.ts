import { ConflictException, HttpException, Injectable, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { Int, ISOLATION_LEVEL, Transaction as SqlTransaction, VarChar, type Request as SqlRequest } from 'mssql';
import { and, auditLogs, eq, parts, vendorParts, vendors, type Database } from '@ares/db';
import { saveSapKanbanSchema, type SapKanbanMasterList, type SapKanbanMasterRow, type SaveSapKanbanInput, type SaveSapKanbanResult } from '@ares/contracts';
import { InjectDb } from '../db/db.module';
import { StagingDbService } from './staging-db.service';

const CATALOG = `
WITH pairs AS (
  SELECT DISTINCT RTRIM(CHR_SUPPLIER_ID) AS supplierId, RTRIM(CHR_PART_NO) AS material
  FROM dbo.TM_VENDOR_PARTS
  UNION
  SELECT RTRIM(CHR_WC_VENDOR), RTRIM(CHR_PART_NO) FROM dbo.TM_KANBAN
  WHERE CHR_KANBAN_TYPE = 'S' AND ISNULL(RTRIM(CHR_FLAG_DELETE), '') IN ('', '0')
), supplier AS (
  SELECT RTRIM(CHR_SUPPLIER_ID) AS supplierId, MIN(NULLIF(RTRIM(CHR_SUPPLIER_NAME), '')) AS supplierName
  FROM dbo.TM_VENDOR WHERE ISNULL(RTRIM(CHR_DEL_FLAG), '') IN ('', '0')
  GROUP BY RTRIM(CHR_SUPPLIER_ID)
)
SELECT TOP (50001)
  K.INT_KANBAN_NO AS kanbanId, VP.supplierId, V.supplierName, VP.material,
  COALESCE(NULLIF(RTRIM(K.CHR_PART_NO_DASH), ''), NULLIF(RTRIM(P.CHR_PART_NO_DASH), ''), VP.material) AS partNo,
  NULLIF(RTRIM(P.CHR_PART_NAME), '') AS partName, NULLIF(RTRIM(P.CHR_PART_UOM), '') AS uom,
  COALESCE(NULLIF(RTRIM(K.CHR_BACK_NO), ''), NULLIF(RTRIM(P.CHR_BACK_NO), '')) AS backNo,
  COALESCE(NULLIF(RTRIM(K.CHR_PLANT), ''), PO.plant) AS plant,
  COALESCE(NULLIF(RTRIM(K.CHR_SLOC_TO), ''), S.singleSloc) AS slocTo,
  S.locations,
  COALESCE(NULLIF(RTRIM(K.CHR_BOX_TYPE), ''), NULLIF(RTRIM(P.CHR_BOX_TYPE), '')) AS boxType,
  NULLIF(RTRIM(K.CHR_RAKNO), '') AS rack, K.INT_QTY_PER_BOX AS qty
FROM pairs VP
LEFT JOIN supplier V ON V.supplierId = VP.supplierId
LEFT JOIN dbo.TM_PARTS P ON RTRIM(P.CHR_PART_NO) = VP.material
  AND ISNULL(RTRIM(P.CHR_FLAG_DELETE), '') IN ('', '0')
OUTER APPLY (
  SELECT * FROM dbo.TM_KANBAN K WHERE RTRIM(K.CHR_PART_NO) = VP.material
    AND RTRIM(K.CHR_WC_VENDOR) = VP.supplierId AND K.CHR_KANBAN_TYPE = 'S'
    AND ISNULL(RTRIM(K.CHR_FLAG_DELETE), '') IN ('', '0')
) K
OUTER APPLY (
  SELECT STRING_AGG(CONVERT(varchar(max), RTRIM(CHR_SLOC)), ', ') AS locations,
    CASE WHEN COUNT(DISTINCT RTRIM(CHR_SLOC)) = 1 THEN MIN(NULLIF(RTRIM(CHR_SLOC), '')) END AS singleSloc
  FROM dbo.TM_PARTS_SLOC WHERE RTRIM(CHR_PART_NO) = VP.material
    AND ISNULL(RTRIM(CHR_FLAG_DELETE), '') IN ('', '0')
) S
OUTER APPLY (
  SELECT CASE WHEN COUNT(DISTINCT NULLIF(RTRIM(L.CHR_PLANT_NO), '')) = 1
    THEN MIN(NULLIF(RTRIM(L.CHR_PLANT_NO), '')) END AS plant
  FROM dbo.TT_PO_LINE L JOIN dbo.TT_PO_HEADER H ON H.CHR_PO_NO = L.CHR_PO_NO
  WHERE RTRIM(H.CHR_SUPPLIER_ID) = VP.supplierId AND RTRIM(L.CHR_PART_NO) = VP.material
) PO
WHERE NULLIF(VP.supplierId, '') IS NOT NULL AND NULLIF(VP.material, '') IS NOT NULL
  AND (@supplierId IS NULL OR VP.supplierId = @supplierId)
  AND (@material IS NULL OR VP.material = @material)
ORDER BY V.supplierName, VP.supplierId, VP.material, K.INT_KANBAN_NO
`;

type SourceRow = Omit<SapKanbanMasterRow, 'blockedReason'>;

@Injectable()
export class SapKanbanService {
  constructor(private readonly staging: StagingDbService, @InjectDb() private readonly db: Database) {}

  private async catalog(request: SqlRequest, supplierId: string | null = null, material: string | null = null) {
    const result = await request.input('supplierId', VarChar(10), supplierId)
      .input('material', VarChar(18), material).query<SourceRow>(CATALOG);
    if (result.recordset.length > 50000) throw new UnprocessableEntityException('Data master melebihi batas pembacaan. Hubungi administrator.');
    return result.recordset.map((row): SapKanbanMasterRow => ({
      ...row,
      blockedReason: !row.supplierName ? 'Supplier belum tersedia atau nonaktif di staging.'
        : !row.partName || !row.uom ? 'Data part belum lengkap atau nonaktif di staging.'
        : !row.backNo ? 'Back number belum tersedia di staging.'
        : row.supplierId.length > 8 ? 'Kode supplier melebihi kapasitas kolom vendor kanban staging.'
        : row.backNo.length > 6 || (row.boxType?.length ?? 0) > 4 || (row.plant?.length ?? 0) > 3
          || (row.slocTo?.length ?? 0) > 8 ? 'Atribut master melebihi kapasitas kolom kanban staging.' : null,
    }));
  }

  async list(search = '', page = 1): Promise<SapKanbanMasterList> {
    try {
      const pool = await this.staging.connect();
      const catalog = await this.catalog(pool.request());
      const query = search.trim().toLowerCase();
      const rows = catalog.filter((row) => !query || [row.supplierId, row.supplierName, row.material, row.partNo, row.partName, row.backNo]
        .some((value) => value?.toLowerCase().includes(query)));
      const totalPages = Math.max(1, Math.ceil(rows.length / 50));
      const currentPage = Math.min(Math.max(1, page), totalPages);
      return { rows: rows.slice((currentPage - 1) * 50, currentPage * 50), page: currentPage, total: rows.length, totalPages };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException('Master kanban staging belum dapat dibaca. Periksa koneksi dan tabel sumber.');
    }
  }

  async save(input: SaveSapKanbanInput, userId: number): Promise<SaveSapKanbanResult> {
    const parsed = saveSapKanbanSchema.safeParse(input);
    if (!parsed.success) throw new UnprocessableEntityException('Qty per kanban harus angka bulat minimal 1.');
    const value = parsed.data;
    const pool = await this.staging.connect();
    const tx = new SqlTransaction(pool);
    let committed = false;
    await tx.begin(ISOLATION_LEVEL.SERIALIZABLE);
    try {
      const rows = await this.catalog(tx.request(), value.supplierId, value.material);
      const row = value.kanbanId === null
        ? rows.length === 1 ? rows[0] : undefined
        : rows.find((candidate) => candidate.kanbanId === value.kanbanId);
      if (!row) throw new NotFoundException('Data kanban telah berubah atau tidak ditemukan di staging. Muat ulang daftar.');
      if (row.blockedReason) throw new UnprocessableEntityException(row.blockedReason);
      if (row.qty !== value.expectedQty && row.qty !== value.qty) {
        throw new ConflictException('Qty sudah diubah oleh pengguna lain. Muat ulang daftar sebelum menyimpan.');
      }
      // Catat intent sebelum commit ke SQL Server agar pengiriman yang terputus dapat ditelusuri.
      const auditId = (await this.db.insert(auditLogs).values({
        entity: 'SAP.TM_KANBAN', entityId: `${row.supplierId}/${row.material}`,
        action: 'KANBAN_QTY_REQUEST', userId,
        before: { kanbanId: row.kanbanId, qty: row.qty },
        after: { qty: value.qty, status: 'PENDING' },
      }).$returningId())[0]!.id;
      let kanbanId = row.kanbanId;
      if (kanbanId === null) {
        const created = await tx.request()
          .input('supplier', VarChar(8), row.supplierId).input('part', VarChar(18), row.material)
          .input('back', VarChar(6), row.backNo).input('plant', VarChar(3), row.plant)
          .input('sloc', VarChar(8), row.slocTo).input('box', VarChar(4), row.boxType)
          .input('dash', VarChar(25), row.partNo).input('qty', Int, value.qty)
          .query<{ kanbanId: number }>(`INSERT INTO dbo.TM_KANBAN
            (CHR_KANBAN_TYPE, CHR_PART_NO, CHR_WC_VENDOR, CHR_BACK_NO, CHR_PLANT,
             CHR_SLOC_TO, CHR_BOX_TYPE, CHR_PART_NO_DASH, INT_QTY_PER_BOX, CHR_FLAG_DELETE)
            OUTPUT INSERTED.INT_KANBAN_NO AS kanbanId
            VALUES ('S', @part, @supplier, @back, @plant, @sloc, @box, @dash, @qty, '0')`);
        kanbanId = created.recordset[0]!.kanbanId;
      } else if (row.qty !== value.qty) {
        await tx.request().input('id', Int, kanbanId).input('part', VarChar(18), row.material)
          .input('qty', Int, value.qty)
          .query(`UPDATE dbo.TM_KANBAN SET INT_QTY_PER_BOX = @qty
            WHERE INT_KANBAN_NO = @id AND CHR_KANBAN_TYPE = 'S' AND CHR_PART_NO = @part`);
      }
      await tx.commit();
      committed = true;
      const savedId = kanbanId;
      const localUpdated = await this.db.transaction(async (local) => {
        const [vendor] = await local.select({ id: vendors.id }).from(vendors).where(eq(vendors.sapVendorNo, row.supplierId));
        const [part] = await local.select({ id: parts.id }).from(parts).where(eq(parts.sapMaterialNo, row.material));
        let updated = false;
        if (vendor && part) {
          const [current] = await local.select().from(vendorParts).where(and(eq(vendorParts.vendorId, vendor.id), eq(vendorParts.partId, part.id))).for('update');
          if (current?.usesKanban) {
            await local.update(vendorParts).set({ qtyPerBox: value.qty }).where(eq(vendorParts.id, current.id));
          } else if (!current) {
            await local.insert(vendorParts).values({
              vendorId: vendor.id, partId: part.id, qtyPerBox: value.qty,
              backNo: row.backNo!, rack: row.rack, boxType: row.boxType,
            });
          }
          updated = true;
        }
        await local.update(auditLogs).set({
          action: 'STAGING_KANBAN_QTY',
          after: { kanbanId: savedId, qty: value.qty, localUpdated: updated, status: 'SAVED' },
        }).where(eq(auditLogs.id, auditId));
        return updated;
      });
      return { kanbanId: savedId, qty: value.qty, localUpdated };
    } catch (error) {
      if (!committed) await tx.rollback().catch(() => undefined);
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException(committed
        ? 'Qty tersimpan di staging. Simpan ulang untuk menyelaraskan data ARES.'
        : 'Penyimpanan terputus. Muat ulang daftar sebelum mencoba kembali.');
    }
  }
}
