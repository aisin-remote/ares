import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  and,
  asc,
  eq,
  inArray,
  ne,
  or,
  sql,
  vendors,
  vendorParts,
  parts,
  picklistHeaders,
  picklistLines,
  receiptHeaders,
  receiptLines,
  kanbans,
  kanbanEvents,
  scanEvents,
  stockMutations,
  sapOutbox,
  type Database,
  type Transaction,
} from '@ares/db';
import {
  parseScanCode,
  validateKanbanScan,
  closeScanSession,
  picklistStatusPathOnClose,
  ReasonRequiredError,
  InvalidTransitionError,
  type KanbanForScan,
  type CloseLineInput,
  picklistStatusAfterReceiptCancel,
  kanbanStatusAfterReceiptCancel,
} from '@ares/domain';
import type { PicklistStatus } from '@ares/contracts';
import { InjectDb } from '../db/db.module';
import { SequenceService } from '../common/sequence.service';
import type { Actor } from '../picklist/picklist.service';
import { writeAudit } from '../common/audit';

/**
 * Picklist yang boleh dibuka sesi scannya. PRINTED/belum konfirmasi tetap
 * boleh diterima (catatan 6.4); PARTIAL menunggu revisi (F-25, fase 2).
 */
const RECEIVABLE: readonly PicklistStatus[] = ['ISSUED', 'DOWNLOADED', 'SHIPPED'];

/**
 * Sesi scan kedatangan (F-34–F-38, 6.4, 6.5). Satu sesi = satu TT_RECEIPT_H.
 * Keputusan (terima/tolak, COMPLETE/PARTIAL, status yang dilalui) semuanya
 * dari packages/domain; di sini hanya baca, kunci baris, dan tulis.
 */
@Injectable()
export class ReceivingService {
  /** Storage location tujuan GR; nilai final menunggu fase 0 (PRD §13). */
  private readonly sloc = process.env.SAP_SLOC ?? 'WH00';

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly sequence: SequenceService,
  ) {}

  /**
   * F-34: buka sesi dengan barcode picklist. Satu sesi OPEN per picklist —
   * scan ulang barcode-nya melanjutkan sesi yang ada (F-39), bukan membuat
   * sesi kedua. Baris picklist dikunci supaya dua stasiun yang membuka
   * bersamaan tidak sama-sama lolos pemeriksaan "belum ada sesi".
   */
  async open(code: string, actor: Actor) {
    const parsed = parseScanCode(code);
    if (parsed?.kind !== 'PICKLIST') throw new BadRequestException('Bukan barcode Order Sheet ARES');

    const opened = await this.db.transaction(async (tx) => {
      const [pl] = await tx
        .select({ id: picklistHeaders.id, status: picklistHeaders.status })
        .from(picklistHeaders)
        .where(
          and(
            eq(picklistHeaders.picklistNo, parsed.no),
            eq(picklistHeaders.revision, parsed.revision),
            eq(picklistHeaders.plantId, actor.plantId),
          ),
        )
        .for('update');
      if (!pl)
        throw new NotFoundException(`Order Sheet ${parsed.no}-${parsed.revision} tidak ditemukan`);
      if (!RECEIVABLE.includes(pl.status)) {
        throw new ConflictException(
          `Order Sheet ${parsed.no} berstatus ${pl.status}, tidak bisa diterima`,
        );
      }

      const [existing] = await tx
        .select({ id: receiptHeaders.id })
        .from(receiptHeaders)
        .where(and(eq(receiptHeaders.picklistId, pl.id), eq(receiptHeaders.status, 'OPEN')));
      if (existing) return { id: existing.id, resumed: true };

      const receiptNo = await this.sequence.next(tx, 'RCP');
      const publicId = randomUUID();
      const id = (
        await tx
          .insert(receiptHeaders)
          .values({ publicId, plantId: actor.plantId, receiptNo, picklistId: pl.id, status: 'OPEN' })
          .$returningId()
      )[0]!.id;
      await writeAudit(tx, 'TT_RECEIPT_H', id, 'OPEN', actor.userId, null,
        { receiptNo, picklistId: pl.id, status: 'OPEN' });
      return { id, resumed: false };
    });

    return { ...(await this.get(opened.id, actor.plantId)), resumed: opened.resumed };
  }

  /**
   * F-36/F-38: satu scan kanban. Baris kanban dikunci FOR UPDATE sehingga dua
   * scan kode yang sama berurutan, bukan berebut; DEDUPE_KEY `receiptId:kode`
   * di TT_SCAN_EVENT menjadi jaminan di database — kode yang sama di sesi
   * yang sama hanya tercatat sekali, apa pun hasilnya. Scan ulang kanban yang
   * sudah diterima dijawab DUPLICATE oleh domain (kuning, 6.4), tanpa tulisan.
   */
  async scan(receiptId: number, code: string, actor: Actor) {
    const now = new Date();
    const session = await this.db.transaction(async (tx) => {
      const s = await this.openSession(tx, receiptId, actor.plantId);
      const parsed = parseScanCode(code);

      let kanban: KanbanForScan | null = null;
      let lineId: number | null = null;
      let serial: number | null = null;
      if (parsed?.kind === 'KANBAN') {
        const [row] = await tx
          .select({
            id: kanbans.id,
            status: kanbans.status,
            receiptId: kanbans.receiptId,
            receivedAt: kanbans.receivedAt,
            serial: kanbans.serial,
            picklistLineId: kanbans.picklistLineId,
            picklistNo: picklistHeaders.picklistNo,
            picklistRevision: picklistHeaders.revision,
          })
          .from(kanbans)
          .innerJoin(picklistLines, eq(kanbans.picklistLineId, picklistLines.id))
          .innerJoin(picklistHeaders, eq(picklistLines.picklistId, picklistHeaders.id))
          .where(eq(kanbans.id, parsed.id))
          .for('update');
        if (row) {
          kanban = row;
          lineId = row.picklistLineId;
          serial = row.serial;
        }
      }

      const verdict = validateKanbanScan(kanban, {
        id: s.id,
        picklistNo: s.picklistNo,
        picklistRevision: s.picklistRevision,
      });
      if (verdict.result === 'DUPLICATE') return { s, verdict, lineId, serial };

      const trimmed = code.trim();
      await this.recordScan(tx, {
        dedupeKey: `${s.id}:${trimmed}`,
        sessionId: s.id,
        code: trimmed,
        result: verdict.result,
        message: verdict.message,
        userId: actor.userId,
        occurredAt: now,
      });

      if (verdict.result === 'OK' && kanban) {
        await tx
          .update(kanbans)
          .set({ status: 'RECEIVED', receiptId: s.id, receivedAt: now })
          .where(eq(kanbans.id, kanban.id));
        const base = {
          kanbanId: kanban.id,
          userId: actor.userId,
          occurredAt: now,
          ref: s.receiptNo,
        };
        await tx.insert(kanbanEvents).values([
          // Diterima tanpa konfirmasi supplier: dicatat sebagai konfirmasi otomatis (6.4).
          ...(verdict.autoShipped ? [{ ...base, type: 'SHIPPED_AUTO' as const }] : []),
          { ...base, type: 'RECEIVED' as const },
        ]);
      }
      return { s, verdict, lineId, serial };
    });

    // F-35: counter line yang tersentuh, supaya layar tidak perlu memuat ulang.
    const line =
      session.verdict.result !== 'REJECTED' && session.lineId
        ? await this.lineProgress(session.s.id, session.lineId)
        : null;
    return { ...session.verdict, kanbanSerial: session.serial, line };
  }

  /**
   * 6.5: tutup sesi. Domain menentukan MISSING, COMPLETE/PARTIAL, dan pcs per
   * line; di sini receipt line, stok WH (6.5.4), status kanban/line/picklist,
   * semua dalam satu transaksi. GR ke SAP dikumpulkan worker dari receipt
   * CLOSED (6.5.3), bukan ditulis di sini.
   */
  async close(receiptId: number, reason: string | undefined, actor: Actor) {
    return this.db.transaction(async (tx) => {
      const s = await this.openSession(tx, receiptId, actor.plantId);
      const [pl] = await tx
        .select({
          id: picklistHeaders.id,
          publicId: picklistHeaders.publicId,
          status: picklistHeaders.status,
          plantId: picklistHeaders.plantId,
        })
        .from(picklistHeaders)
        .where(eq(picklistHeaders.id, s.picklistId))
        .for('update');
      if (!pl) throw new NotFoundException('Order Sheet sesi ini tidak ditemukan');

      const lines = await tx
        .select({
          id: picklistLines.id,
          qtyPerBox: picklistLines.qtyPerBox,
          boxReceived: picklistLines.boxReceived,
          partId: vendorParts.partId,
        })
        .from(picklistLines)
        .innerJoin(vendorParts, eq(picklistLines.vendorPartId, vendorParts.id))
        .where(eq(picklistLines.picklistId, pl.id));
      const lineIds = lines.map((l) => l.id);
      const ks = lineIds.length
        ? await tx
            .select({
              id: kanbans.id,
              status: kanbans.status,
              receiptId: kanbans.receiptId,
              picklistLineId: kanbans.picklistLineId,
            })
            .from(kanbans)
            .where(inArray(kanbans.picklistLineId, lineIds))
            .for('update')
        : [];

      const input: CloseLineInput[] = lines.map((l) => ({
        picklistLineId: l.id,
        qtyPerBox: l.qtyPerBox,
        kanbans: ks.filter((k) => k.picklistLineId === l.id),
      }));

      let closed: ReturnType<typeof closeScanSession>;
      let path: PicklistStatus[];
      try {
        closed = closeScanSession(input, s.id, reason);
        path = picklistStatusPathOnClose(pl.status, closed.picklistStatus);
      } catch (e) {
        if (e instanceof ReasonRequiredError) throw new UnprocessableEntityException(e.message);
        if (e instanceof InvalidTransitionError) throw new ConflictException(e.message);
        throw e;
      }

      const now = new Date();
      if (closed.missingKanbanIds.length > 0) {
        await tx
          .update(kanbans)
          .set({ status: 'MISSING' })
          .where(inArray(kanbans.id, closed.missingKanbanIds));
        await tx.insert(kanbanEvents).values(
          closed.missingKanbanIds.map((kanbanId) => ({
            kanbanId,
            type: 'MISSING' as const,
            userId: actor.userId,
            occurredAt: now,
            ref: s.receiptNo,
          })),
        );
      }

      const lineById = new Map(lines.map((l) => [l.id, l]));
      for (const r of closed.lines) {
        const line = lineById.get(r.picklistLineId)!;
        if (r.boxReceived > 0) {
          const receiptLineId = (
            await tx
              .insert(receiptLines)
              .values({
                receiptId: s.id,
                picklistLineId: r.picklistLineId,
                boxReceived: r.boxReceived,
                pcsReceived: r.pcsReceived,
              })
              .$returningId()
          )[0]!.id;
          // 6.5.4: stok WH naik saat receipt dibuat, bukan saat GR terkonfirmasi.
          await tx.insert(stockMutations).values({
            plantId: pl.plantId,
            partId: line.partId,
            sloc: this.sloc,
            deltaPcs: r.pcsReceived,
            type: 'RECEIPT',
            refTable: 'TT_RECEIPT_L',
            refId: receiptLineId,
            userId: actor.userId,
            occurredAt: now,
          });
        }
        const totalReceived = line.boxReceived + r.boxReceived;
        await tx
          .update(picklistLines)
          .set({
            boxReceived: totalReceived,
            // Tidak ada lagi yang ditunggu di line ini → RECEIVED.
            ...(r.boxMissing === 0 && totalReceived > 0 ? { status: 'RECEIVED' as const } : {}),
          })
          .where(eq(picklistLines.id, r.picklistLineId));
      }

      const finalStatus = path[path.length - 1];
      if (finalStatus) {
        await tx
          .update(picklistHeaders)
          .set({ status: finalStatus })
          .where(eq(picklistHeaders.id, pl.id));
      }
      await tx
        .update(receiptHeaders)
        .set({
          status: 'CLOSED',
          closedAt: now,
          userId: actor.userId,
          note: reason?.trim() || null,
        })
        .where(eq(receiptHeaders.id, s.id));

      await writeAudit(tx, 'TT_RECEIPT_H', s.id, 'CLOSE', actor.userId,
        { status: 'OPEN', picklistStatus: pl.status, receiptNo: s.receiptNo },
        { status: 'CLOSED', picklistStatus: finalStatus ?? pl.status,
          boxReceived: closed.lines.reduce((sum, line) => sum + line.boxReceived, 0),
          missingKanbanIds: closed.missingKanbanIds, reason: reason?.trim() || null });

      return {
        id: s.id,
        publicId: s.publicId,
        receiptNo: s.receiptNo,
        picklistId: pl.id,
        picklistPublicId: pl.publicId,
        picklistNo: s.picklistNo,
        picklistStatus: finalStatus ?? pl.status,
        missingCount: closed.missingKanbanIds.length,
        lines: closed.lines,
      };
    });
  }

  /** F-40: pembatalan receipt; GR yang sudah keluar dari ARES dibuatkan movement pembalik 102. */
  async cancel(receiptId: number, reason: string, actor: Actor) {
    return this.db.transaction(async (tx) => {
      const [receipt] = await tx.select().from(receiptHeaders)
        .where(and(eq(receiptHeaders.id, receiptId), eq(receiptHeaders.plantId, actor.plantId)))
        .for('update');
      if (!receipt) throw new NotFoundException('Receipt tidak ditemukan');
      if (receipt.status === 'CANCELLED') throw new ConflictException('Receipt sudah dibatalkan');
      const [pl] = await tx.select().from(picklistHeaders)
        .where(eq(picklistHeaders.id, receipt.picklistId)).for('update');
      if (!pl) throw new NotFoundException('Order Sheet receipt tidak ditemukan');
      const [outbox] = await tx.select().from(sapOutbox)
        .where(and(eq(sapOutbox.sourceTable, 'TT_RECEIPT_H'),
          eq(sapOutbox.sourceId, receiptId), eq(sapOutbox.docType, 'GR'))).for('update');
      const grSudahTerkirim = outbox
        ? ['PROCESSING', 'STAGED', 'POSTED'].includes(outbox.status)
        : false;
      if (outbox && !grSudahTerkirim && outbox.status !== 'SKIPPED') {
        await tx.update(sapOutbox).set({ status: 'SKIPPED', lastError: `Receipt dibatalkan: ${reason}`.slice(0, 1000) })
          .where(eq(sapOutbox.id, outbox.id));
      }

      let reversalOutboxId: number | null = null;
      if (grSudahTerkirim && outbox) {
        const payload = outbox.payload && typeof outbox.payload === 'object'
          ? outbox.payload as Record<string, unknown>
          : {};
        const reversalReady = outbox.status === 'POSTED' && Boolean(outbox.sapDocNumber);
        reversalOutboxId = (await tx.insert(sapOutbox).values({
          plantId: receipt.plantId,
          sourceTable: 'TT_RECEIPT_H',
          sourceId: receiptId,
          docType: 'GR_REVERSAL',
          movementType: '102',
          idempotencyKey: `${receipt.receiptNo}:REV`,
          payload: {
            ...payload,
            docType: 'GR_REVERSAL',
            movementType: '102',
            idempotencyKey: `${receipt.receiptNo}:REV`,
            reversalOf: outbox.sapDocNumber,
            reason,
          },
          status: reversalReady ? 'PENDING' : 'HELD',
          lastError: reversalReady ? null : 'Menunggu nomor dokumen GR asli dari SAP',
          occurredAt: new Date(),
        }).$returningId())[0]!.id;
      }

      const received = await tx.select({ id: kanbans.id }).from(kanbans)
        .where(eq(kanbans.receiptId, receiptId)).for('update');
      const receivedIds = received.map((row) => row.id);
      const autoEvents = receivedIds.length ? await tx.select({ id: kanbanEvents.kanbanId })
        .from(kanbanEvents)
        .where(and(inArray(kanbanEvents.kanbanId, receivedIds),
          eq(kanbanEvents.type, 'SHIPPED_AUTO'), eq(kanbanEvents.ref, receipt.receiptNo))) : [];
      const autoIds = new Set(autoEvents.map((row) => row.id));
      for (const id of receivedIds) {
        await tx.update(kanbans).set({
          status: grSudahTerkirim ? 'SHIPPED' : kanbanStatusAfterReceiptCancel(autoIds.has(id)),
          receiptId: null, receivedAt: null,
        }).where(eq(kanbans.id, id));
      }

      if (receipt.status === 'CLOSED') {
        const [other] = await tx.select({ id: receiptHeaders.id }).from(receiptHeaders)
          .where(and(eq(receiptHeaders.picklistId, pl.id), eq(receiptHeaders.status, 'CLOSED'),
            ne(receiptHeaders.id, receiptId)))
          .orderBy(asc(receiptHeaders.id));
        if (other)
          throw new ConflictException('Ada receipt lain yang sudah ditutup untuk Order Sheet ini');
        const missingEvents = await tx.select({ id: kanbanEvents.kanbanId }).from(kanbanEvents)
          .where(and(eq(kanbanEvents.type, 'MISSING'), eq(kanbanEvents.ref, receipt.receiptNo)));
        for (const event of missingEvents) {
          await tx.update(kanbans)
            .set({ status: grSudahTerkirim ? 'SHIPPED' : pl.shippedAt ? 'SHIPPED' : 'PRINTED' })
            .where(and(eq(kanbans.id, event.id), eq(kanbans.status, 'MISSING')));
        }

        const lines = await tx.select({
          id: receiptLines.id, picklistLineId: receiptLines.picklistLineId,
          boxReceived: receiptLines.boxReceived, pcsReceived: receiptLines.pcsReceived,
          totalReceived: picklistLines.boxReceived, boxOrdered: picklistLines.boxOrdered,
          boxShipped: picklistLines.boxShipped, lineStatus: picklistLines.status,
          partId: vendorParts.partId,
        }).from(receiptLines)
          .innerJoin(picklistLines, eq(receiptLines.picklistLineId, picklistLines.id))
          .innerJoin(vendorParts, eq(picklistLines.vendorPartId, vendorParts.id))
          .where(eq(receiptLines.receiptId, receiptId));
        const now = new Date();
        for (const line of lines) {
          const total = line.totalReceived - line.boxReceived;
          if (total < 0) throw new ConflictException('Jumlah box receipt tidak cocok dengan Order Sheet');
          await tx.insert(stockMutations).values({
            plantId: receipt.plantId, partId: line.partId, sloc: this.sloc,
            deltaPcs: -line.pcsReceived, type: 'ADJUST', refTable: 'TT_RECEIPT_L', refId: line.id,
            note: `Pembatalan ${receipt.receiptNo}: ${reason}`.slice(0, 255),
            userId: actor.userId, occurredAt: now,
          });
          await tx.update(picklistLines).set({ boxReceived: total,
            status: line.lineStatus === 'RECEIVED' && total === 0
              ? line.boxShipped !== null && line.boxShipped < line.boxOrdered ? 'SHORT' : 'OPEN'
              : line.lineStatus,
          }).where(eq(picklistLines.id, line.picklistLineId));
        }
        await tx.update(picklistHeaders)
          .set(grSudahTerkirim
            ? { status: 'SHIPPED', shippedAt: pl.shippedAt ?? now }
            : { status: picklistStatusAfterReceiptCancel(pl) })
          .where(eq(picklistHeaders.id, pl.id));
      }

      const note = `${receipt.note ? `${receipt.note} | ` : ''}Dibatalkan: ${reason}`.slice(0, 255);
      await tx.update(receiptHeaders).set({ status: 'CANCELLED', note, userId: actor.userId })
        .where(eq(receiptHeaders.id, receiptId));
      await writeAudit(tx, 'TT_RECEIPT_H', receiptId, 'CANCEL', actor.userId,
        { ...receipt, picklistStatus: pl.status, outboxStatus: outbox?.status ?? null },
        { ...receipt, status: 'CANCELLED', note,
          picklistStatus: receipt.status === 'CLOSED'
            ? grSudahTerkirim ? 'SHIPPED' : picklistStatusAfterReceiptCancel(pl)
            : pl.status,
          outboxStatus: grSudahTerkirim ? outbox?.status : outbox ? 'SKIPPED' : null,
          reversalOutboxId, kanbanRestored: receivedIds.length, reason });
      return {
        id: receiptId,
        publicId: receipt.publicId,
        status: 'CANCELLED' as const,
        picklistId: pl.id,
        picklistPublicId: pl.publicId,
        reversalOutboxId,
      };
    });
  }

  async resolveId(reference: string, plantId: number): Promise<number> {
    const legacyId = /^\d+$/.test(reference) ? Number(reference) : null;
    const [row] = await this.db.select({ id: receiptHeaders.id }).from(receiptHeaders).where(and(
      legacyId && Number.isSafeInteger(legacyId)
        ? or(eq(receiptHeaders.publicId, reference), eq(receiptHeaders.id, legacyId))
        : eq(receiptHeaders.publicId, reference),
      eq(receiptHeaders.plantId, plantId),
    )).limit(1);
    if (!row) throw new NotFoundException('Sesi scan tidak ditemukan');
    return row.id;
  }

  /** F-35: progres per line — box diorder / dikirim / discan di sesi ini. */
  async get(receiptId: number, plantId?: number) {
    const [r] = await this.db
      .select({
        id: receiptHeaders.id,
        publicId: receiptHeaders.publicId,
        receiptNo: receiptHeaders.receiptNo,
        status: receiptHeaders.status,
        openedAt: receiptHeaders.createdAt,
        closedAt: receiptHeaders.closedAt,
        note: receiptHeaders.note,
        picklistId: picklistHeaders.id,
        picklistPublicId: picklistHeaders.publicId,
        picklistNo: picklistHeaders.picklistNo,
        revision: picklistHeaders.revision,
        picklistStatus: picklistHeaders.status,
        vendorName: vendors.name,
        deliveryDate: picklistHeaders.deliveryDate,
        arrivalTime: picklistHeaders.arrivalTime,
      })
      .from(receiptHeaders)
      .innerJoin(picklistHeaders, eq(receiptHeaders.picklistId, picklistHeaders.id))
      .innerJoin(vendors, eq(picklistHeaders.vendorId, vendors.id))
      .where(and(
        eq(receiptHeaders.id, receiptId),
        plantId ? eq(receiptHeaders.plantId, plantId) : undefined,
      ));
    if (!r) throw new NotFoundException('Sesi scan tidak ditemukan');

    const lines = await this.db
      .select({
        id: picklistLines.id,
        partNo: parts.partNo,
        partName: parts.name,
        backNo: vendorParts.backNo,
        boxOrdered: picklistLines.boxOrdered,
        boxShipped: picklistLines.boxShipped,
        boxReceived: picklistLines.boxReceived,
        boxScanned: this.scannedExpr(receiptId),
        status: picklistLines.status,
      })
      .from(picklistLines)
      .innerJoin(vendorParts, eq(picklistLines.vendorPartId, vendorParts.id))
      .innerJoin(parts, eq(vendorParts.partId, parts.id))
      .where(eq(picklistLines.picklistId, r.picklistId))
      .orderBy(asc(picklistLines.id));

    const out = lines.map((l) => ({ ...l, boxScanned: Number(l.boxScanned) }));
    return {
      ...r,
      lines: out,
      totals: {
        boxOrdered: out.reduce((n, l) => n + l.boxOrdered, 0),
        boxShipped: out.reduce((n, l) => n + (l.boxShipped ?? 0), 0),
        boxScanned: out.reduce((n, l) => n + l.boxScanned, 0),
      },
    };
  }

  /** Sesi harus ada dan masih OPEN; barisnya dikunci selama transaksi. */
  private async openSession(tx: Transaction, receiptId: number, plantId: number) {
    const [s] = await tx
      .select({
        id: receiptHeaders.id,
        publicId: receiptHeaders.publicId,
        receiptNo: receiptHeaders.receiptNo,
        status: receiptHeaders.status,
        picklistId: receiptHeaders.picklistId,
        picklistPublicId: picklistHeaders.publicId,
        picklistNo: picklistHeaders.picklistNo,
        picklistRevision: picklistHeaders.revision,
      })
      .from(receiptHeaders)
      .innerJoin(picklistHeaders, eq(receiptHeaders.picklistId, picklistHeaders.id))
      .where(and(eq(receiptHeaders.id, receiptId), eq(receiptHeaders.plantId, plantId)))
      .for('update');
    if (!s) throw new NotFoundException('Sesi scan tidak ditemukan');
    if (s.status !== 'OPEN') throw new ConflictException(`Sesi ${s.receiptNo} sudah ${s.status}`);
    return s;
  }

  /** Mengembalikan false bila DEDUPE_KEY sudah ada (scan dobel, F-38). */
  private async recordScan(tx: Transaction, v: typeof scanEvents.$inferInsert): Promise<boolean> {
    try {
      await tx.insert(scanEvents).values(v);
      return true;
    } catch (err) {
      const e = err as { errno?: number; cause?: { errno?: number } };
      if ((e?.errno ?? e?.cause?.errno) !== 1062) throw err;
      return false;
    }
  }

  /**
   * Box yang discan di sesi ini per line. Nama tabel/kolom ditulis eksplisit:
   * di dalam subquery Drizzle merender kolom luar tanpa nama tabel, sehingga
   * `PICKLIST_LINE_ID = ID` diam-diam membandingkan dengan ID kanban sendiri.
   */
  private scannedExpr(receiptId: number) {
    return sql<number>`(select count(*) from TM_KANBAN k where k.PICKLIST_LINE_ID = TT_PICKLIST_L.ID and k.RECEIPT_ID = ${receiptId} and k.STATUS = 'RECEIVED')`;
  }

  private async lineProgress(receiptId: number, lineId: number) {
    const [l] = await this.db
      .select({
        id: picklistLines.id,
        boxOrdered: picklistLines.boxOrdered,
        boxShipped: picklistLines.boxShipped,
        boxScanned: this.scannedExpr(receiptId),
      })
      .from(picklistLines)
      .where(eq(picklistLines.id, lineId));
    return l ? { ...l, boxScanned: Number(l.boxScanned) } : null;
  }
}
