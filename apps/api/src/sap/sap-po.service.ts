import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, count, desc, eq, inArray, poHeaders, poLines, settings, vendors, parts, type Database } from '@ares/db';
import { addMonths, normalizeSapPo, poPullTarget, samePoUnit, sapPoMonth, type SapPoRow } from '@ares/domain';
import { writeAudit } from '../common/audit';
import { InjectDb } from '../db/db.module';
import { QueueService } from '../queue/queue.service';
import { JOBS, QUEUES } from '../queue/queue.constants';
import { readStagingConfig } from './staging.config';
import { SapPoGateway } from './sap-po.gateway';
import type { PoSyncResult } from '@ares/contracts';

@Injectable()
export class SapPoService {
  constructor(@InjectDb() private readonly db: Database, private readonly gateway: SapPoGateway, private readonly queue: QueueService) {}

  async enqueue(month: string, preview: boolean, userId: number) {
    if (!preview && !readStagingConfig().STAGING_PULL_ENABLED) throw new ConflictException('Penarikan PO belum diaktifkan');
    const jobId = await this.queue.add(QUEUES.SAP, JOBS.SAP_SYNC_PO, { month, preview, userId });
    return { queued: true, jobId };
  }

  async job(id: string) {
    const job = await this.queue.get(QUEUES.SAP).getJob(id);
    if (!job || job.name !== JOBS.SAP_SYNC_PO) throw new NotFoundException('Proses tarik PO tidak ditemukan');
    return { state: await job.getState(), result: job.returnvalue as PoSyncResult | null, error: job.failedReason || null };
  }

  /** F-44: tanggal tarik PO bulanan, diubah Admin/PPIC; baris awal dari migrasi 0025. */
  async pullDay(): Promise<number> {
    const [row] = await this.db.select({ value: settings.value }).from(settings)
      .where(eq(settings.key, 'PO_PULL_DAY')).limit(1);
    return Number(row?.value ?? 24);
  }

  async setPullDay(day: number, userId: number) {
    await this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(settings).where(eq(settings.key, 'PO_PULL_DAY')).for('update');
      if (row) await tx.update(settings).set({ value: String(day) }).where(eq(settings.id, row.id));
      else await tx.insert(settings).values({ key: 'PO_PULL_DAY', value: String(day) });
      await writeAudit(tx, 'TM_SETTING', 'PO_PULL_DAY', 'UPDATE', userId, { value: row?.value ?? null }, { value: String(day) });
    });
    return { pullDay: day };
  }

  /** Job harian worker: tarik hanya pada tanggal tarik, untuk PO bulan berikutnya. */
  async runScheduled(now = new Date()) {
    if (!readStagingConfig().STAGING_PULL_ENABLED) return { skipped: 'Penarikan PO nonaktif' };
    const target = poPullTarget(now, await this.pullDay());
    return target ? this.sync(target) : { skipped: 'Bukan tanggal tarik PO' };
  }

  async status(month = sapPoMonth()) {
    const [rows] = await this.db.select({ count: count() }).from(poHeaders)
      .where(and(eq(poHeaders.source, 'SAP'), eq(poHeaders.validFrom, `${month}-01`)));
    const [last] = await this.db.select({ at: poLines.syncedAt }).from(poLines)
      .innerJoin(poHeaders, eq(poHeaders.id, poLines.poId))
      .where(and(eq(poHeaders.source, 'SAP'), eq(poHeaders.validFrom, `${month}-01`)))
      .orderBy(desc(poLines.syncedAt)).limit(1);
    return {
      enabled: readStagingConfig().STAGING_PULL_ENABLED, month, count: Number(rows?.count ?? 0),
      syncedAt: last?.at ?? null, pullDay: await this.pullDay(),
    };
  }

  /**
   * Tarik PO untuk bulan order `month`: PO yang dibuat SAP sebulan sebelumnya
   * (keputusan 2026-11-03). Dipanggil worker; seluruh item satu PO diterapkan
   * atomik, PO lain tetap bisa diproses.
   */
  async sync(month = addMonths(sapPoMonth(), 1), preview = false): Promise<PoSyncResult> {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Bulan PO tidak valid');
    if (!preview && !readStagingConfig().STAGING_PULL_ENABLED) throw new ConflictException('Penarikan PO dinonaktifkan');
    const raw = await this.gateway.readMonth(addMonths(month, -1));
    const result: PoSyncResult = { month, preview, fetched: raw.length, imported: 0, failed: 0, issues: [], rows: [] };
    const groups = new Map<string, SapPoRow[]>();
    for (const row of raw) groups.set(row.poNo.trim(), [...(groups.get(row.poNo.trim()) ?? []), row]);
    const supplierCodes = [...new Set(raw.map((row) => row.vendorNo?.trim()).filter((x): x is string => Boolean(x)))];
    const materials = [...new Set(raw.map((row) => row.material?.trim()).filter((x): x is string => Boolean(x)))];
    const [supplierRows, partRows] = await Promise.all([
      supplierCodes.length ? this.db.select().from(vendors).where(inArray(vendors.sapVendorNo, supplierCodes)) : Promise.resolve([]),
      materials.length ? this.db.select().from(parts).where(inArray(parts.sapMaterialNo, materials)) : Promise.resolve([]),
    ]);
    for (const [poNo, source] of groups) {
      try {
        const normalized = source.map(normalizeSapPo);
        const first = normalized[0]!;
        if (first.validFrom !== `${month}-01` || normalized.some((row) => row.vendorNo !== first.vendorNo || row.validFrom !== first.validFrom))
          throw new Error('Supplier atau periode dalam satu PO tidak konsisten');
        if (new Set(normalized.map((row) => row.item)).size !== normalized.length) throw new Error('Item PO duplikat pada sumber SAP');
        const supplier = supplierRows.find((row) => row.sapVendorNo === first.vendorNo && row.isActive);
        if (!supplier) throw new Error(`Supplier ${first.vendorNo} belum terdaftar/aktif di ARES`);
        const mapped = normalized.map((row) => {
          const part = partRows.find((p) => p.sapMaterialNo === row.material && p.isActive);
          if (!part) throw new Error(`Material ${row.material} belum terdaftar/aktif di ARES`);
          if (!samePoUnit(row.uom, part.uom)) throw new Error(`Satuan material ${row.material} berbeda: SAP ${row.uom}, ARES ${part.uom}`);
          return { ...row, partId: part.id };
        });
        await this.db.transaction(async (tx) => {
          const [existing] = await tx.select().from(poHeaders).where(eq(poHeaders.sapPoNo, poNo)).for('update');
          if (existing && (existing.source !== 'SAP' || existing.vendorId !== supplier.id || existing.validFrom !== first.validFrom))
            throw new Error('Nomor PO sudah ada dengan sumber, supplier, atau periode berbeda; perlu pemeriksaan');
          const stored = existing ? await tx.select().from(poLines).where(eq(poLines.poId, existing.id)).for('update') : [];
          for (const row of mapped) {
            const previous = stored.find((line) => line.item === row.item);
            if (previous && (previous.partId !== row.partId || previous.sapPlantNo !== row.plant || previous.sapUom !== row.uom))
              throw new Error(`Identitas material/plant/satuan item ${row.item} berubah; perlu pemeriksaan`);
          }
          if (preview) return;
          const poId = existing?.id ?? (await tx.insert(poHeaders).values({
            sapPoNo: poNo, source: 'SAP', vendorId: supplier.id, validFrom: first.validFrom, validTo: first.validTo,
          }).$returningId())[0]!.id;
          for (const row of mapped) {
            // Qty PO menjadi batas pesanan ARES; sisanya dihitung dari Order Sheet (F-19).
            const values = { partId: row.partId, orderedQty: row.orderedQty, openQty: row.inactive ? 0 : row.orderedQty,
              balanceVerified: true, isActive: !row.inactive, sapPlantNo: row.plant, sapUom: row.uom, syncedAt: new Date() };
            await tx.insert(poLines).values({ poId, item: row.item, ...values }).onDuplicateKeyUpdate({ set: values });
          }
          // Item yang hilang dari PO pada snapshot lengkap tidak boleh tetap tersedia untuk order.
          for (const line of stored.filter((line) => !mapped.some((row) => row.item === line.item))) {
            await tx.update(poLines).set({ openQty: 0, isActive: false, syncedAt: new Date() }).where(eq(poLines.id, line.id));
          }
        });
        result.imported += mapped.length;
        result.rows.push(...mapped.slice(0, Math.max(0, 100 - result.rows.length)).map(({ poNo, item, vendorNo, material, orderedQty }) => ({ poNo, item, vendorNo, material, orderedQty })));
      } catch (error) {
        result.failed += source.length;
        // Hanya error validasi boleh terlihat; rincian SQL/credential tidak dikirim ke browser.
        const reason = error instanceof Error && !('query' in error) && !('code' in error)
          ? error.message : 'Gagal menyimpan PO; periksa log database';
        if (result.issues.length < 100) result.issues.push({ poNo, reason });
      }
    }
    return result;
  }
}
