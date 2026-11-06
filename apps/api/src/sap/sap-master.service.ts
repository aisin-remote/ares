import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { parts, vendorParts, vendors, eq, type Database } from '@ares/db';
import { normalizeSapPart, normalizeSapVendor, pickSapPackaging } from '@ares/domain';
import type { MasterSyncResult } from '@ares/contracts';
import { InjectDb } from '../db/db.module';
import { QueueService } from '../queue/queue.service';
import { JOBS, QUEUES } from '../queue/queue.constants';
import { writeAudit } from '../common/audit';
import { readStagingConfig } from './staging.config';
import { SapMasterGateway } from './sap-master.gateway';

const reason = (error: unknown) =>
  error instanceof Error && !('query' in error) && !('code' in error) ? error.message : 'Gagal menyimpan; periksa log database';

/**
 * Tarik master supplier, part, dan vendor part dari A_DB_STG (F-01, F-02).
 *
 * Hanya supplier dan part yang dipakai TM_VENDOR_PARTS SAP atau sudah ada di
 * ARES yang diambil — daftar vendor SAP memuat seluruh purchasing org.
 * Kolom milik ARES (pabrik, jadwal kirim, email, kemasan vendor part yang
 * sudah ada) tidak pernah ditimpa.
 * ponytail: tidak menonaktifkan vendor part yang hilang dari staging dan
 * hanya lewat tombol (audit butuh user); tambahkan jadwal bila SAP sudah rutin.
 */
@Injectable()
export class SapMasterService {
  constructor(@InjectDb() private readonly db: Database, private readonly gateway: SapMasterGateway, private readonly queue: QueueService) {}

  async enqueue(preview: boolean, userId: number) {
    if (!preview && !readStagingConfig().STAGING_PULL_ENABLED) throw new ConflictException('Penarikan data SAP belum diaktifkan');
    const jobId = await this.queue.add(QUEUES.SAP, JOBS.SAP_SYNC_MASTER, { preview, userId });
    return { queued: true, jobId };
  }

  async job(id: string) {
    const job = await this.queue.get(QUEUES.SAP).getJob(id);
    if (!job || job.name !== JOBS.SAP_SYNC_MASTER) throw new NotFoundException('Proses tarik master tidak ditemukan');
    return { state: await job.getState(), result: job.returnvalue as MasterSyncResult | null, error: job.failedReason || null };
  }

  async sync(preview: boolean, userId: number): Promise<MasterSyncResult> {
    if (!preview && !readStagingConfig().STAGING_PULL_ENABLED) throw new ConflictException('Penarikan data SAP dinonaktifkan');
    const raw = await this.gateway.read();
    const result: MasterSyncResult = {
      preview,
      vendors: { created: 0, updated: 0, unchanged: 0 },
      parts: { created: 0, updated: 0, unchanged: 0 },
      vendorParts: { created: 0, existing: 0, skipped: 0 },
      issues: [],
    };
    const issue = (key: string, why: string) => { if (result.issues.length < 200) result.issues.push({ key, reason: why }); };

    // Pasangan dobel di staging tidak boleh menabrak unique (PART_ID, VENDOR_ID).
    const pairs = [...new Map(raw.vendorParts
      .map((row) => ({ supplierId: row.supplierId?.trim() ?? '', material: row.material?.trim() ?? '' }))
      .filter((row) => row.supplierId && row.material)
      .map((row) => [`${row.supplierId}|${row.material}`, row] as const)).values()];
    const [localVendors, localParts] = await Promise.all([this.db.select().from(vendors), this.db.select().from(parts)]);
    const wantedVendors = new Set([...pairs.map((p) => p.supplierId), ...localVendors.map((v) => v.sapVendorNo ?? '')]);
    const wantedParts = new Set([...pairs.map((p) => p.material), ...localParts.map((p) => p.sapMaterialNo)]);

    await this.db.transaction(async (tx) => {
      // ── supplier ──
      const vendorId = new Map<string, number | null>();
      for (const row of raw.vendors) {
        if (!wantedVendors.has(row.supplierId?.trim() ?? '')) continue;
        try {
          const next = normalizeSapVendor(row);
          const current = localVendors.find((v) => v.sapVendorNo === next.sapVendorNo);
          if (!current) {
            result.vendors.created++;
            if (preview) { vendorId.set(next.sapVendorNo, null); continue; }
            const id = (await tx.insert(vendors).values(next).$returningId())[0]!.id;
            await writeAudit(tx, 'TM_VENDOR', id, 'SYNC_SAP', userId, null, next);
            vendorId.set(next.sapVendorNo, id);
            continue;
          }
          vendorId.set(next.sapVendorNo, current.id);
          const before = { name: current.name, address: current.address, isActive: current.isActive };
          if (before.name === next.name && before.address === next.address && before.isActive === next.isActive) {
            result.vendors.unchanged++; continue;
          }
          result.vendors.updated++;
          if (preview) continue;
          await tx.update(vendors).set({ name: next.name, address: next.address, isActive: next.isActive }).where(eq(vendors.id, current.id));
          await writeAudit(tx, 'TM_VENDOR', current.id, 'SYNC_SAP', userId, before, next);
        } catch (error) { issue(`Supplier ${row.supplierId?.trim() || '?'}`, reason(error)); }
      }

      // ── part ──
      const partByMaterial = new Map<string, { id: number | null; row: (typeof raw.parts)[number] }>();
      for (const row of raw.parts) {
        if (!wantedParts.has(row.material?.trim() ?? '')) continue;
        try {
          const next = normalizeSapPart(row);
          const current = localParts.find((p) => p.sapMaterialNo === next.sapMaterialNo);
          const clash = localParts.find((p) => p.partNo === next.partNo && p.sapMaterialNo !== next.sapMaterialNo);
          if (clash) throw new Error(`Nomor part ${next.partNo} sudah dipakai material ${clash.sapMaterialNo}`);
          if (!current) {
            result.parts.created++;
            if (preview) { partByMaterial.set(next.sapMaterialNo, { id: null, row }); continue; }
            const id = (await tx.insert(parts).values(next).$returningId())[0]!.id;
            await writeAudit(tx, 'TM_PARTS', id, 'SYNC_SAP', userId, null, next);
            partByMaterial.set(next.sapMaterialNo, { id, row });
            continue;
          }
          partByMaterial.set(next.sapMaterialNo, { id: current.id, row });
          const before = { partNo: current.partNo, name: current.name, uom: current.uom, isActive: current.isActive };
          if (before.partNo === next.partNo && before.name === next.name && before.uom === next.uom && before.isActive === next.isActive) {
            result.parts.unchanged++; continue;
          }
          result.parts.updated++;
          if (preview) continue;
          await tx.update(parts).set({ partNo: next.partNo, name: next.name, uom: next.uom, isActive: next.isActive }).where(eq(parts.id, current.id));
          await writeAudit(tx, 'TM_PARTS', current.id, 'SYNC_SAP', userId, before, next);
        } catch (error) { issue(`Part ${row.material?.trim() || '?'}`, reason(error)); }
      }

      // ── vendor part: hanya pasangan baru; kemasan yang sudah ada milik PPIC/supplier ──
      const localVendorParts = await tx.select({ vendorId: vendorParts.vendorId, partId: vendorParts.partId }).from(vendorParts);
      for (const pair of pairs) {
        const key = `${pair.supplierId} / ${pair.material}`;
        if (!vendorId.has(pair.supplierId)) { issue(key, 'Supplier tidak ada/valid di TM_VENDOR staging'); continue; }
        const part = partByMaterial.get(pair.material);
        if (!part) { issue(key, 'Part tidak ada/valid di TM_PARTS staging'); continue; }
        const vId = vendorId.get(pair.supplierId)!;
        if (vId !== null && part.id !== null && localVendorParts.some((vp) => vp.vendorId === vId && vp.partId === part.id)) {
          result.vendorParts.existing++; continue;
        }
        const packaging = pickSapPackaging(pair.supplierId, part.row, raw.kanbans.filter((k) => k.material?.trim() === pair.material));
        if (!packaging) {
          result.vendorParts.skipped++;
          issue(key, 'Qty per box atau back number kosong di SAP; buat vendor part manual');
          continue;
        }
        result.vendorParts.created++;
        if (preview || vId === null || part.id === null) continue;
        const values = { vendorId: vId, partId: part.id, ...packaging };
        const id = (await tx.insert(vendorParts).values(values).$returningId())[0]!.id;
        await writeAudit(tx, 'TM_VENDOR_PARTS', id, 'SYNC_SAP', userId, null, values);
      }
    });
    return result;
  }
}
