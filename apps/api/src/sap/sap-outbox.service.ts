import { Injectable, Logger } from '@nestjs/common';
import { eq, and, sql, desc, count, inArray, notExists, type Database } from '@ares/db';
import {
  sapOutbox,
  plants,
  receiptHeaders,
  receiptLines,
  picklistHeaders,
  picklistLines,
  vendorParts,
  parts,
} from '@ares/db';
import { InjectDb } from '../db/db.module';

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
  async collect(): Promise<{ dikumpulkan: number; ditahan: number; dilewati: number }> {
    const receipts = await this.db
      .select({
        id: receiptHeaders.id,
        receiptNo: receiptHeaders.receiptNo,
        plantId: receiptHeaders.plantId,
        plantCode: plants.code,
        closedAt: receiptHeaders.closedAt,
        picklistNo: picklistHeaders.picklistNo,
      })
      .from(receiptHeaders)
      .innerJoin(plants, eq(receiptHeaders.plantId, plants.id))
      .innerJoin(picklistHeaders, eq(receiptHeaders.picklistId, picklistHeaders.id))
      .where(
        and(
          eq(receiptHeaders.status, 'CLOSED'),
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
    for (const r of receipts) {
      const items = await this.db
        .select({
          poNo: picklistLines.sapPoNo,
          poItem: picklistLines.sapPoItem,
          material: parts.sapMaterialNo,
          qty: receiptLines.pcsReceived,
          uom: parts.uom,
        })
        .from(receiptLines)
        .innerJoin(picklistLines, eq(receiptLines.picklistLineId, picklistLines.id))
        .innerJoin(vendorParts, eq(picklistLines.vendorPartId, vendorParts.id))
        .innerJoin(parts, eq(vendorParts.partId, parts.id))
        .where(eq(receiptLines.receiptId, r.id));

      const occurredAt = r.closedAt ?? new Date();
      const status = items.length > 0 ? 'PENDING' : 'SKIPPED';
      const baru = await this.simpan({
        plantId: r.plantId,
        sourceTable: 'TT_RECEIPT_H',
        sourceId: r.id,
        docType: 'GR',
        movementType: '101',
        idempotencyKey: r.receiptNo,
        status,
        lastError: status === 'SKIPPED' ? 'Tidak ada pcs diterima di sesi ini' : null,
        payload: {
          docType: 'GR',
          idempotencyKey: r.receiptNo,
          plant: r.plantCode,
          sloc: process.env.SAP_SLOC ?? 'WH00',
          deliveryNote: r.picklistNo,
          postingDate: tanggalJakarta(occurredAt),
          items,
        },
        occurredAt,
      });
      if (!baru) continue;
      if (status === 'PENDING') dikumpulkan += 1;
      else dilewati += 1;
    }
    if (dikumpulkan > 0) this.logger.log(`${dikumpulkan} GR dikumpulkan ke outbox`);
    return { dikumpulkan, ditahan: 0, dilewati };
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
      await this.db.insert(sapOutbox).values(v);
      return true;
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
  async releaseHeld(): Promise<{ dilepas: number }> {
    const hasil = await this.db
      .update(sapOutbox)
      .set({ status: 'PENDING', lastError: null })
      .where(and(eq(sapOutbox.status, 'HELD'), sql`${sapOutbox.movementType} IS NOT NULL`));
    const dilepas = Number((hasil as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0);
    if (dilepas > 0) this.logger.log(`${dilepas} dokumen tertahan dilepas ke antrean kirim`);
    return { dilepas };
  }

  async summary() {
    const rows = await this.db
      .select({ status: sapOutbox.status, jumlah: count() })
      .from(sapOutbox)
      .groupBy(sapOutbox.status);
    const map = Object.fromEntries(rows.map((r) => [r.status, Number(r.jumlah)]));
    return {
      pending: map.PENDING ?? 0,
      sent: map.SENT ?? 0,
      failed: map.FAILED ?? 0,
      held: map.HELD ?? 0,
      skipped: map.SKIPPED ?? 0,
    };
  }

  async list(params: { page: number; perPage: number; status?: string }) {
    const offset = (params.page - 1) * params.perPage;
    const filter =
      params.status && params.status !== 'ALL'
        ? eq(sapOutbox.status, params.status as 'PENDING')
        : undefined;

    const [rows, totalRows] = await Promise.all([
      this.db
        .select({
          id: sapOutbox.id,
          plantCode: plants.code,
          docType: sapOutbox.docType,
          movementType: sapOutbox.movementType,
          sourceTable: sapOutbox.sourceTable,
          sourceId: sapOutbox.sourceId,
          status: sapOutbox.status,
          attempts: sapOutbox.attempts,
          lastError: sapOutbox.lastError,
          sapDocNumber: sapOutbox.sapDocNumber,
          occurredAt: sapOutbox.occurredAt,
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
  async retry(ids: number[]): Promise<{ diulang: number }> {
    if (ids.length === 0) return { diulang: 0 };
    await this.db
      .update(sapOutbox)
      .set({ status: 'PENDING', lastError: null })
      .where(and(inArray(sapOutbox.id, ids), eq(sapOutbox.status, 'FAILED')));
    return { diulang: ids.length };
  }
}

/** YYYY-MM-DD pada zona pabrik — tanggal posting GR (PRD 8.1). */
function tanggalJakarta(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(d);
}
