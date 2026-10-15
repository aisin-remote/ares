import { Injectable, Logger } from '@nestjs/common';
import { eq, and, or, isNull, lt, lte, gte, sql, desc, count, inArray, notExists, type Database } from '@ares/db';
import {
  sapOutbox,
  plants,
  receiptHeaders,
  receiptLines,
  picklistHeaders,
  picklistLines,
  vendorParts,
  parts,
  vendors,
  poHeaders,
  poLines,
} from '@ares/db';
import { InjectDb } from '../db/db.module';
import { writeAudit } from '../common/audit';
import { orderSheetDisplayNo, validateGrForSap } from '@ares/domain';

/**
 * Mengumpulkan perpindahan barang menjadi dokumen untuk SAP.
 *
 * ── Kenapa mengumpulkan, bukan menulis saat kejadian ──────────────────────
 *
 * Alternatifnya adalah memanggil "catat ke outbox" di enam service yang
 * berbeda — penerimaan, transfer, pulling, pengiriman, scan produksi,
 * backflush. Enam tempat yang harus diingat, dan yang ketujuh pasti terlupa.
 *
 * Di sini sumbernya satu: buku besar mutasi. Dokumen yang belum punya baris
 * outbox dicari dengan NOT EXISTS, bukan dengan penanda posisi terakhir.
 * Penanda posisi punya lubang yang terkenal — transaksi yang commit belakangan
 * tetapi memperoleh id lebih kecil akan terlewat, dan tidak ada yang
 * memberitahu. NOT EXISTS ditambah unique index membuat pengumpulan ini
 * idempoten dan tidak bisa bocor.
 */
@Injectable()
export class SapOutboxService {
  private readonly logger = new Logger(SapOutboxService.name);

  constructor(@InjectDb() private readonly db: Database) {}

  /**
   * Mengumpulkan dokumen yang siap dikirim ke SAP.
   *
   * ARES: satu baris outbox GR per receipt CLOSED (PRD 6.5 butir 3, F-45).
   * Sumbernya TT_RECEIPT_H yang belum punya baris outbox — NOT EXISTS, bukan
   * penanda posisi, supaya idempoten; IDEMPOTENCY_KEY = nomor receipt (F-47).
   * Payload mengikuti contoh PRD 8.1. Receipt tanpa pcs diterima dicatat
   * SKIPPED supaya tidak dipungut ulang tiap menit.
   */
  async collect(plantId?: number): Promise<{ dikumpulkan: number; ditahan: number; dilewati: number }> {
    const receipts = await this.db
      .select({
        id: receiptHeaders.id,
        receiptNo: receiptHeaders.receiptNo,
        plantId: receiptHeaders.plantId,
        closedAt: receiptHeaders.closedAt,
      })
      .from(receiptHeaders)
      .where(
        and(
          eq(receiptHeaders.status, 'CLOSED'),
          plantId ? eq(receiptHeaders.plantId, plantId) : undefined,
          notExists(
            this.db
              .select({ one: sql`1` })
              .from(sapOutbox)
              .where(
                and(
                  eq(sapOutbox.sourceTable, 'TT_RECEIPT_H'),
                  eq(sapOutbox.sourceId, receiptHeaders.id),
                  eq(sapOutbox.docType, 'GR'),
                ),
              ),
          ),
        ),
      )
      .limit(200);

    let dikumpulkan = 0;
    let dilewati = 0;
    let ditahan = 0;
    for (const r of receipts) {
      const gr = await this.buildGr(r.id);
      if (!gr) continue;

      const occurredAt = r.closedAt ?? new Date();
      const status = gr.items.length === 0 ? 'SKIPPED' : gr.errors.length > 0 ? 'HELD' : 'PENDING';
      const baru = await this.simpan({
        plantId: r.plantId,
        sourceTable: 'TT_RECEIPT_H',
        sourceId: r.id,
        docType: 'GR',
        movementType: '101',
        idempotencyKey: r.receiptNo,
        status,
        lastError: status === 'SKIPPED'
          ? 'Tidak ada pcs diterima di sesi ini'
          : status === 'HELD'
            ? `Validasi GR: ${gr.errors.join('; ')}`.slice(0, 1000)
            : null,
        payload: gr.payload,
        occurredAt,
      });
      if (!baru) continue;
      if (status === 'PENDING') dikumpulkan += 1;
      else if (status === 'HELD') ditahan += 1;
      else dilewati += 1;
    }
    if (dikumpulkan > 0) this.logger.log(`${dikumpulkan} GR dikumpulkan ke outbox`);
    return { dikumpulkan, ditahan, dilewati };
  }

  private async buildGr(receiptId: number) {
    const [header] = await this.db.select({
      receiptNo: receiptHeaders.receiptNo,
      plant: plants.code,
      closedAt: receiptHeaders.closedAt,
      vendorId: picklistHeaders.vendorId,
      vendorNo: vendors.sapVendorNo,
      deliveryDate: picklistHeaders.deliveryDate,
      picklistNo: picklistHeaders.picklistNo,
      revision: picklistHeaders.revision,
    }).from(receiptHeaders)
      .innerJoin(plants, eq(receiptHeaders.plantId, plants.id))
      .innerJoin(picklistHeaders, eq(receiptHeaders.picklistId, picklistHeaders.id))
      .innerJoin(vendors, eq(picklistHeaders.vendorId, vendors.id))
      .where(eq(receiptHeaders.id, receiptId));
    if (!header) return null;

    const items = await this.db.select({
      poNo: picklistLines.sapPoNo,
      poItem: picklistLines.sapPoItem,
      material: parts.sapMaterialNo,
      qty: receiptLines.pcsReceived,
      uom: parts.uom,
      poVendorId: poHeaders.vendorId,
      poPartId: poLines.partId,
      partId: parts.id,
      poOpenQty: poLines.openQty,
    }).from(receiptLines)
      .innerJoin(picklistLines, eq(receiptLines.picklistLineId, picklistLines.id))
      .innerJoin(vendorParts, eq(picklistLines.vendorPartId, vendorParts.id))
      .innerJoin(parts, eq(vendorParts.partId, parts.id))
      .leftJoin(poHeaders, and(
        eq(poHeaders.sapPoNo, picklistLines.sapPoNo),
        eq(poHeaders.vendorId, header.vendorId),
        or(isNull(poHeaders.validFrom), lte(poHeaders.validFrom, header.deliveryDate)),
        or(isNull(poHeaders.validTo), gte(poHeaders.validTo, header.deliveryDate)),
      ))
      .leftJoin(poLines, and(
        eq(poLines.poId, poHeaders.id),
        eq(poLines.item, picklistLines.sapPoItem),
        eq(poLines.partId, parts.id),
      ))
      .where(eq(receiptLines.receiptId, receiptId));

    const errors = validateGrForSap({
      plant: header.plant,
      vendorNo: header.vendorNo,
      items: items.map((item) => ({
        ...item,
        poMatchesVendor: item.poVendorId === header.vendorId,
        poMatchesPart: item.poPartId === item.partId,
      })),
    });
    const occurredAt = header.closedAt ?? new Date();
    return {
      items,
      errors,
      payload: {
        docType: 'GR',
        idempotencyKey: header.receiptNo,
        plant: header.plant,
        vendorNo: header.vendorNo,
        sloc: process.env.SAP_SLOC ?? 'WH00',
        deliveryNote: orderSheetDisplayNo(header.picklistNo, header.revision),
        postingDate: tanggalJakarta(occurredAt),
        items: items.map(({ poVendorId: _poVendorId, poPartId: _poPartId, partId: _partId, poOpenQty: _poOpenQty, ...item }) => item),
      },
    };
  }

  /**
   * Menyimpan satu dokumen. Mengembalikan false bila dokumennya SUDAH ADA.
   *
   * Pembedaan ini bukan kerapian belaka: tanpa itu penghitung melaporkan
   * jumlah yang DICOBA, bukan yang benar-benar baru, dan layar pemantauan akan
   * mengatakan "7 dokumen siap kirim" setiap menit selamanya — seolah antrean
   * terus bertambah padahal tidak ada yang berubah.
   */
  private async simpan(v: {
    plantId: number;
    sourceTable: string;
    sourceId: number;
    docType: string;
    movementType: string | null;
    idempotencyKey: string;
    status: 'PENDING' | 'HELD' | 'SKIPPED';
    lastError: string | null;
    payload: unknown;
    occurredAt: Date;
  }): Promise<boolean> {
    try {
      return await this.db.transaction(async (tx) => {
        /* Sinkron dengan cancel receipt: receipt dikunci dulu, lalu outbox. */
        const [source] = await tx.select({ status: receiptHeaders.status })
          .from(receiptHeaders)
          .where(eq(receiptHeaders.id, v.sourceId))
          .for('update');
        if (!source || source.status !== 'CLOSED') return false;
        await tx.insert(sapOutbox).values(v);
        return true;
      });
    } catch (err) {
      // Unique index yang menolak berarti dokumen ini sudah dikumpulkan —
      // entah pada putaran sebelumnya, entah oleh pengumpul lain yang berjalan
      // bersamaan. Itu justru yang diinginkan.
      const e = err as { errno?: number; cause?: { errno?: number } };
      if ((e?.errno ?? e?.cause?.errno) !== 1062) throw err;
      return false;
    }
  }

  /**
   * Melepas dokumen yang tertahan (HELD) ke antrean kirim.
   *
   * ARES: GR selalu movement type 101 (pembatalan 102), jadi HELD hanya dipakai
   * bila tim SAP belum mengunci nomor movement type — begitu diisi di
   * MOVEMENT_TYPE, baris ini dilepas. Tanpa nomor, tetap ditahan.
   */
  async releaseHeld(plantId?: number): Promise<{ dilepas: number }> {
    const rows = await this.db.select().from(sapOutbox).where(and(
      eq(sapOutbox.status, 'HELD'),
      sql`(${sapOutbox.lastError} IS NULL OR ${sapOutbox.lastError} NOT LIKE 'Ditahan manual:%')`,
      plantId ? eq(sapOutbox.plantId, plantId) : undefined,
    )).limit(100);
    let dilepas = 0;
    for (const row of rows) {
      const checked = await this.revalidate(row);
      if (checked.errors.length > 0 || !row.movementType) {
        const errors = !row.movementType
          ? ['Movement type SAP belum tersedia', ...checked.errors]
          : checked.errors;
        await this.db.update(sapOutbox).set({
          lastError: `Validasi SAP: ${errors.join('; ')}`.slice(0, 1000),
        }).where(and(eq(sapOutbox.id, row.id), eq(sapOutbox.status, 'HELD')));
        continue;
      }
      await this.db.update(sapOutbox).set({
        status: 'PENDING', payload: checked.payload, lastError: null, nextAttemptAt: null,
      }).where(and(eq(sapOutbox.id, row.id), eq(sapOutbox.status, 'HELD')));
      dilepas += 1;
    }
    if (dilepas > 0) this.logger.log(`${dilepas} dokumen tertahan dilepas ke antrean kirim`);
    return { dilepas };
  }

  private async revalidate(row: typeof sapOutbox.$inferSelect): Promise<{ payload: unknown; errors: string[] }> {
    if (row.docType === 'GR') {
      const gr = await this.buildGr(row.sourceId);
      return gr
        ? { payload: gr.payload, errors: gr.errors }
        : { payload: row.payload, errors: ['Receipt sumber tidak ditemukan'] };
    }
    if (row.docType === 'GR_REVERSAL') {
      const [original] = await this.db.select({
        status: sapOutbox.status,
        sapDocNumber: sapOutbox.sapDocNumber,
      }).from(sapOutbox).where(and(
        eq(sapOutbox.sourceTable, row.sourceTable),
        eq(sapOutbox.sourceId, row.sourceId),
        eq(sapOutbox.docType, 'GR'),
      ));
      if (original?.status !== 'POSTED' || !original.sapDocNumber)
        return { payload: row.payload, errors: ['Menunggu nomor dokumen GR asli dari SAP'] };
      const payload = row.payload && typeof row.payload === 'object'
        ? { ...row.payload as Record<string, unknown>, reversalOf: original.sapDocNumber }
        : row.payload;
      return { payload, errors: [] };
    }
    return { payload: row.payload, errors: [] };
  }

  async summary(plantId?: number) {
    const rows = await this.db
      .select({ status: sapOutbox.status, jumlah: count() })
      .from(sapOutbox)
      .where(plantId ? eq(sapOutbox.plantId, plantId) : undefined)
      .groupBy(sapOutbox.status);
    const map = Object.fromEntries(rows.map((r) => [r.status, Number(r.jumlah)]));
    return {
      pending: map.PENDING ?? 0,
      processing: map.PROCESSING ?? 0,
      staged: map.STAGED ?? 0,
      posted: map.POSTED ?? 0,
      failed: map.FAILED ?? 0,
      held: map.HELD ?? 0,
      skipped: map.SKIPPED ?? 0,
    };
  }

  async list(params: {
    page: number;
    perPage: number;
    status?: string;
    docType?: string;
    from?: Date;
    toExclusive?: Date;
  }, plantId?: number) {
    const offset = (params.page - 1) * params.perPage;
    const filter = and(
      params.status && params.status !== 'ALL'
        ? eq(sapOutbox.status, params.status as 'PENDING')
        : undefined,
      params.docType && params.docType !== 'ALL' ? eq(sapOutbox.docType, params.docType) : undefined,
      params.from ? gte(sapOutbox.occurredAt, params.from) : undefined,
      params.toExclusive ? lt(sapOutbox.occurredAt, params.toExclusive) : undefined,
      plantId ? eq(sapOutbox.plantId, plantId) : undefined,
    );

    const [rows, totalRows] = await Promise.all([
      this.db
        .select({
          id: sapOutbox.id,
          plantCode: plants.code,
          docType: sapOutbox.docType,
          movementType: sapOutbox.movementType,
          sourceTable: sapOutbox.sourceTable,
          sourceId: sapOutbox.sourceId,
          idempotencyKey: sapOutbox.idempotencyKey,
          status: sapOutbox.status,
          attempts: sapOutbox.attempts,
          lastError: sapOutbox.lastError,
          sapDocNumber: sapOutbox.sapDocNumber,
          occurredAt: sapOutbox.occurredAt,
          nextAttemptAt: sapOutbox.nextAttemptAt,
          lastAttemptAt: sapOutbox.lastAttemptAt,
          stagedAt: sapOutbox.stagedAt,
          postedAt: sapOutbox.postedAt,
          sentAt: sapOutbox.sentAt,
        })
        .from(sapOutbox)
        .leftJoin(plants, eq(sapOutbox.plantId, plants.id))
        .where(filter)
        .orderBy(desc(sapOutbox.occurredAt), desc(sapOutbox.id))
        .limit(params.perPage)
        .offset(offset),
      this.db.select({ value: count() }).from(sapOutbox).where(filter),
    ]);

    const total = totalRows[0]?.value ?? 0;
    return {
      data: rows,
      meta: {
        page: params.page,
        perPage: params.perPage,
        total,
        totalPages: Math.max(1, Math.ceil(total / params.perPage)),
      },
    };
  }

  /** Mencoba ulang dokumen yang gagal kirim. */
  async retry(ids: number[], userId: number, plantId?: number): Promise<{ diulang: number; tetapDitahan: number }> {
    if (ids.length === 0) return { diulang: 0, tetapDitahan: 0 };
    const rows = await this.db.select().from(sapOutbox)
      .where(and(inArray(sapOutbox.id, ids), inArray(sapOutbox.status, ['FAILED', 'HELD']),
        plantId ? eq(sapOutbox.plantId, plantId) : undefined));
    let diulang = 0;
    let tetapDitahan = 0;
    for (const row of rows) {
      const checked = await this.revalidate(row);
      await this.db.transaction(async (tx) => {
        const [current] = await tx.select().from(sapOutbox)
          .where(eq(sapOutbox.id, row.id)).for('update');
        if (!current || !['FAILED', 'HELD'].includes(current.status)) return;
        const next = checked.errors.length > 0 ? {
          status: 'HELD' as const,
          payload: checked.payload,
          lastError: `Validasi SAP: ${checked.errors.join('; ')}`.slice(0, 1000),
        } : {
          status: 'PENDING' as const,
          payload: checked.payload,
          lastError: null,
        };
        await tx.update(sapOutbox).set({
          ...next, attempts: 0, nextAttemptAt: null,
        }).where(eq(sapOutbox.id, row.id));
        await writeAudit(tx, 'TT_SAP_OUTBOX', row.id, 'RETRY', userId, current,
          { ...current, ...next, attempts: 0, nextAttemptAt: null });
        if (next.status === 'PENDING') diulang += 1;
        else tetapDitahan += 1;
      });
    }
    return { diulang, tetapDitahan };
  }

  /** F-46: tahan kegagalan agar worker tidak mencobanya sampai dilepas lewat retry. */
  async hold(ids: number[], userId: number, plantId?: number): Promise<{ ditahan: number }> {
    if (ids.length === 0) return { ditahan: 0 };
    return this.db.transaction(async (tx) => {
      const rows = await tx.select().from(sapOutbox)
        .where(and(inArray(sapOutbox.id, ids), eq(sapOutbox.status, 'FAILED'),
          plantId ? eq(sapOutbox.plantId, plantId) : undefined))
        .for('update');
      for (const row of rows) {
        const lastError = `Ditahan manual: ${row.lastError ?? 'tanpa pesan kegagalan'}`.slice(0, 1000);
        await tx.update(sapOutbox).set({ status: 'HELD', lastError })
          .where(eq(sapOutbox.id, row.id));
        await writeAudit(tx, 'TT_SAP_OUTBOX', row.id, 'HOLD', userId, row,
          { ...row, status: 'HELD', lastError });
      }
      return { ditahan: rows.length };
    });
  }
}

/** YYYY-MM-DD pada zona pabrik — tanggal posting GR (PRD 8.1). */
function tanggalJakarta(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(d);
}
