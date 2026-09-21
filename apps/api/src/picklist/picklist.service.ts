import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ulid } from 'ulid';
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  count,
  sql,
  vendors,
  vendorParts,
  vendorCutoffs,
  parts,
  poHeaders,
  poLines,
  picklistHeaders,
  picklistLines,
  kanbans,
  kanbanEvents,
  type Database,
  type Transaction,
} from '@ares/db';
import {
  pickPoItem,
  assertTransition,
  confirmShipment,
  cycleOfCutoff,
  InvalidTransitionError,
  PICKLIST_TRANSITIONS,
  ShipmentError,
  type PoCandidate,
  type ShipmentLineInput,
} from '@ares/domain';
import type {
  ConfirmShipmentInput,
  IssueManualPicklistInput,
  PicklistListQuery,
} from '@ares/contracts';
import type { PicklistNoticeKind } from '../notify/notify.service';
import { InjectDb } from '../db/db.module';
import { SequenceService } from '../common/sequence.service';
import { writeAudit } from '../common/audit';
import { QueueService } from '../queue/queue.service';
import { QUEUES, JOBS } from '../queue/queue.constants';

/** Siapa yang bertindak; diambil dari token user. */
export interface Actor {
  userId: number;
  plantId: number;
}

/**
 * Batas data yang boleh disentuh: id vendor untuk akun supplier, null untuk
 * akun internal (semua vendor).
 *
 * Sengaja parameter WAJIB di setiap fungsi yang membaca atau mengubah
 * picklist, bukan opsional: kalau opsional, lupa mengisinya berarti data semua
 * supplier ikut keluar tanpa satu pun error. Dengan wajib, kelalaian menjadi
 * galat kompilasi (aturan repo 9).
 */
export type VendorScope = number | null;

@Injectable()
export class PicklistService {
  private readonly logger = new Logger(PicklistService.name);

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly sequence: SequenceService,
    private readonly queue: QueueService,
  ) {}

  /**
   * F-17 order manual → picklist MANUAL/ISSUED beserta kanban per box, satu
   * transaksi. Satu part tanpa PO item aktif pada tanggal kirim menolak
   * SELURUH order (F-18, 6.6.1) — PPIC memperbaiki PO atau membuang barisnya.
   *
   * ponytail: cutoffAt = waktu terbit; opsi "digabung ke picklist cutoff
   * berikutnya" (F-17) menyusul bersama job cutoff fase 2.
   */
  async issueManual(input: IssueManualPicklistInput, actor: Actor) {
    const hasil = await this.db.transaction(async (tx) => {
      const [vendor] = await tx
        .select({ id: vendors.id })
        .from(vendors)
        .where(and(eq(vendors.id, input.vendorId), eq(vendors.isActive, true)));
      if (!vendor) throw new NotFoundException('Supplier tidak ditemukan atau nonaktif');

      const cutoff = await this.resolveCutoff(tx, input.vendorId, input.cutoffId);

      const vpIds = input.lines.map((l) => l.vendorPartId);
      const vps = await tx
        .select({
          id: vendorParts.id,
          partId: vendorParts.partId,
          qtyPerBox: vendorParts.qtyPerBox,
          poItemDefaultId: vendorParts.poItemDefaultId,
          partNo: parts.partNo,
        })
        .from(vendorParts)
        .innerJoin(parts, eq(vendorParts.partId, parts.id))
        .where(
          and(
            inArray(vendorParts.id, vpIds),
            eq(vendorParts.vendorId, input.vendorId),
            eq(vendorParts.isActive, true),
          ),
        );
      const vpById = new Map(vps.map((v) => [v.id, v]));
      const unknown = vpIds.filter((id) => !vpById.has(id));
      if (unknown.length > 0) {
        throw new BadRequestException(
          `Vendor part ${unknown.join(', ')} tidak ada, nonaktif, atau bukan milik supplier ini`,
        );
      }

      // 6.6.1: kandidat PO = PO supplier ini untuk part yang diorder; pemilihan di domain.
      const candidates: PoCandidate[] = await tx
        .select({
          poLineId: poLines.id,
          sapPoNo: poHeaders.sapPoNo,
          sapPoItem: poLines.item,
          partId: poLines.partId,
          openQty: poLines.openQty,
          validFrom: poHeaders.validFrom,
          validTo: poHeaders.validTo,
        })
        .from(poLines)
        .innerJoin(poHeaders, eq(poLines.poId, poHeaders.id))
        .where(
          and(
            eq(poHeaders.vendorId, input.vendorId),
            inArray(
              poLines.partId,
              vps.map((v) => v.partId),
            ),
          ),
        );

      const resolved = input.lines.map((line) => {
        const vp = vpById.get(line.vendorPartId)!;
        return {
          line,
          vp,
          po: pickPoItem(candidates, vp.partId, input.deliveryDate, vp.poItemDefaultId),
        };
      });
      const blocked = resolved.filter((r) => !r.po).map((r) => r.vp.partNo);
      if (blocked.length > 0) {
        throw new UnprocessableEntityException(
          `Tidak ada PO item aktif pada ${input.deliveryDate} untuk part: ${blocked.join(', ')}. Order tidak diterbitkan (F-18).`,
        );
      }

      const now = new Date();
      const picklistNo = await this.sequence.next(tx, 'PL', now);
      const picklistId = (
        await tx
          .insert(picklistHeaders)
          .values({
            plantId: actor.plantId,
            picklistNo,
            revision: 0,
            type: 'MANUAL',
            vendorId: input.vendorId,
            cutoffAt: now,
            deliveryDate: input.deliveryDate,
            arrivalTime: cutoff.arrivalTime,
            cycle: cutoff.cycle,
            status: 'ISSUED',
            note: input.note ?? null,
            createdById: actor.userId,
          })
          .$returningId()
      )[0]!.id;

      // Satu kanban per box (F-22): ULID sebagai ID/isi QR, serial urut per picklist.
      const ref = `${picklistNo}-0`;
      let serial = 0;
      const kanbanRows: (typeof kanbans.$inferInsert)[] = [];
      const eventRows: (typeof kanbanEvents.$inferInsert)[] = [];
      for (const r of resolved) {
        const lineId = (
          await tx
            .insert(picklistLines)
            .values({
              picklistId,
              vendorPartId: r.vp.id,
              boxOrdered: r.line.boxes,
              qtyPerBox: r.vp.qtyPerBox,
              pcs: r.line.boxes * r.vp.qtyPerBox,
              sapPoNo: r.po!.sapPoNo,
              sapPoItem: r.po!.sapPoItem,
            })
            .$returningId()
        )[0]!.id;
        for (let i = 0; i < r.line.boxes; i += 1) {
          const id = ulid();
          kanbanRows.push({ id, picklistLineId: lineId, serial: ++serial, status: 'PRINTED' });
          eventRows.push({
            kanbanId: id,
            type: 'PRINTED',
            userId: actor.userId,
            occurredAt: now,
            ref,
          });
        }
      }
      await tx.insert(kanbans).values(kanbanRows);
      await tx.insert(kanbanEvents).values(eventRows);

      await writeAudit(tx, 'TT_PICKLIST_H', picklistId, 'ISSUE', actor.userId, null, {
        picklistNo, revision: 0, status: 'ISSUED', vendorId: input.vendorId,
        deliveryDate: input.deliveryDate, lines: input.lines, kanbanCount: serial,
      });

      return {
        id: picklistId,
        picklistNo,
        revision: 0,
        lineCount: resolved.length,
        kanbanCount: serial,
      };
    });

    await this.enqueueRender(hasil.id);
    await this.enqueueNotice('PICKLIST_ISSUED', hasil.id);
    return hasil;
  }

  /** F-31: email ke akun vendor lewat worker; gagal mengantre hanya dicatat, order tetap terbit. */
  private async enqueueNotice(kind: PicklistNoticeKind, picklistId: number): Promise<void> {
    try {
      await this.queue.add(QUEUES.NOTIFICATION, JOBS.SEND_NOTIFICATION, { kind, picklistId });
    } catch (err) {
      const pesan = err instanceof Error ? err.message : String(err);
      this.logger.error(`picklist ${picklistId}: email ${kind} gagal diantre: ${pesan}`);
    }
  }

  /**
   * F-27: PDF picklist dan kanban dirender worker, bukan di dalam request.
   *
   * Kegagalan mengantre sengaja tidak dilempar ke pemanggil. Picklist-nya
   * sudah tersimpan beserta nomornya, dan nomor tidak pernah dipakai ulang
   * (6.6.2) — membatalkan order yang sudah sempurna hanya karena Redis mati
   * jauh lebih merugikan daripada PDF yang terlambat. Job bisa diulang.
   */
  private async enqueueRender(picklistId: number): Promise<void> {
    try {
      await this.queue.add(QUEUES.DOCUMENT, JOBS.RENDER_PDF, { picklistId });
    } catch (err) {
      const pesan = err instanceof Error ? err.message : String(err);
      this.logger.error(`picklist ${picklistId} terbit tapi render PDF gagal diantre: ${pesan}`);
    }
  }

  /**
   * F-20 / 6.6.3: hanya ISSUED atau DOWNLOADED yang bisa dibatalkan; nomor
   * tidak dipakai ulang (6.6.2). Kanban PRINTED ikut CANCELLED (PRD §3).
   *
   * ponytail: "pcs dikembalikan ke antrean" hanya berlaku untuk type AUTO —
   * antrean (TT_ORDER_QUEUE) menyusul fase 2.
   */
  async cancel(id: number, reason: string, actor: Actor, scope: VendorScope) {
    return this.db.transaction(async (tx) => {
      const [pl] = await tx
        .select()
        .from(picklistHeaders)
        .where(
          and(eq(picklistHeaders.id, id), scope ? eq(picklistHeaders.vendorId, scope) : undefined),
        )
        .for('update');
      if (!pl) throw new NotFoundException('Picklist tidak ditemukan');
      try {
        assertTransition('picklist', pl.status, 'CANCELLED');
      } catch (e) {
        if (e instanceof InvalidTransitionError) throw new ConflictException(e.message);
        throw e;
      }

      const now = new Date();
      const note = `${pl.note ? `${pl.note} | ` : ''}Dibatalkan: ${reason}`.slice(0, 255);
      await tx
        .update(picklistHeaders)
        .set({ status: 'CANCELLED', note })
        .where(eq(picklistHeaders.id, id));
      await tx
        .update(picklistLines)
        .set({ status: 'CANCELLED' })
        .where(eq(picklistLines.picklistId, id));

      const ks = await tx
        .select({ id: kanbans.id })
        .from(kanbans)
        .innerJoin(picklistLines, eq(kanbans.picklistLineId, picklistLines.id))
        .where(and(eq(picklistLines.picklistId, id), eq(kanbans.status, 'PRINTED')));
      if (ks.length > 0) {
        const ids = ks.map((k) => k.id);
        await tx.update(kanbans).set({ status: 'CANCELLED' }).where(inArray(kanbans.id, ids));
        await tx.insert(kanbanEvents).values(
          ids.map((kanbanId) => ({
            kanbanId,
            type: 'CANCELLED' as const,
            userId: actor.userId,
            occurredAt: now,
            ref: `${pl.picklistNo}-${pl.revision}`,
          })),
        );
      }

      await writeAudit(tx, 'TT_PICKLIST_H', id, 'CANCEL', actor.userId, pl, {
        ...pl, status: 'CANCELLED', note, kanbanCancelled: ks.map((k) => k.id), reason,
      });

      return { id, status: 'CANCELLED' as const, kanbanCount: ks.length };
    });
  }

  /**
   * F-30 / 6.3: konfirmasi kirim oleh supplier — satu transaksi.
   *
   * Header → SHIPPED (ISSUED lewat DOWNLOADED dulu: supplier yang mengonfirmasi
   * jelas sudah memegang dokumennya), kanban yang dikirim → SHIPPED + event,
   * line kurang → SHORT. Sisa mengikuti SHORT_SHIP_POLICY cutoff supplier:
   *   CARRY_OVER  kanban sisa CANCELLED (6.3.2);
   *   REVISION    header revisi+1 dengan nomor sama berisi line sisa, kanban
   *               sisa dipindah ke line revisi dan tetap PRINTED (6.3.3, F-25).
   * Setelah SHIPPED tidak bisa diubah lagi dari portal (6.3.4).
   *
   * ponytail: CARRY_OVER belum mengembalikan pcs ke antrean (TT_ORDER_QUEUE
   * fase 2) — boxShort × qtyPerBox tersedia dari domain, tinggal ditulis.
   * ponytail: tanggal kirim revisi = tanggal kirim asal + 1 hari kalender;
   * hari kerja & libur (6.2) menyusul bersama job cutoff fase 2.
   */
  async confirmShipment(id: number, input: ConfirmShipmentInput, actor: { vendorId: number; userId: number }) {
    const hasil = await this.db.transaction(async (tx) => {
      const [pl] = await tx
        .select()
        .from(picklistHeaders)
        .where(and(eq(picklistHeaders.id, id), eq(picklistHeaders.vendorId, actor.vendorId)))
        .for('update');
      if (!pl) throw new NotFoundException('Picklist tidak ditemukan');

      // Status yang dilalui: ISSUED → DOWNLOADED → SHIPPED atau DOWNLOADED → SHIPPED.
      const path: Array<'DOWNLOADED' | 'SHIPPED'> =
        pl.status === 'ISSUED' ? ['DOWNLOADED', 'SHIPPED'] : ['SHIPPED'];
      try {
        let cur = pl.status;
        for (const next of path) {
          assertTransition('picklist', cur, next);
          cur = next;
        }
      } catch (e) {
        if (e instanceof InvalidTransitionError) {
          throw new ConflictException(
            ['SHIPPED', 'PARTIAL', 'COMPLETE'].includes(pl.status)
              ? 'Pengiriman sudah dikonfirmasi; perubahan lewat PPIC (6.3.4)'
              : e.message,
          );
        }
        throw e;
      }

      const lines = await tx
        .select({
          id: picklistLines.id,
          vendorPartId: picklistLines.vendorPartId,
          boxOrdered: picklistLines.boxOrdered,
          qtyPerBox: picklistLines.qtyPerBox,
          sapPoNo: picklistLines.sapPoNo,
          sapPoItem: picklistLines.sapPoItem,
        })
        .from(picklistLines)
        .where(eq(picklistLines.picklistId, pl.id))
        .orderBy(asc(picklistLines.id));
      const lineIds = lines.map((l) => l.id);
      const ks = lineIds.length
        ? await tx
            .select({
              id: kanbans.id,
              serial: kanbans.serial,
              status: kanbans.status,
              picklistLineId: kanbans.picklistLineId,
            })
            .from(kanbans)
            .where(inArray(kanbans.picklistLineId, lineIds))
            .for('update')
        : [];

      const shippedByLine = new Map(input.lines.map((l) => [l.picklistLineId, l.boxShipped]));
      const domainLines: ShipmentLineInput[] = lines.map((l) => {
        const boxShipped = shippedByLine.get(l.id);
        if (boxShipped === undefined) {
          throw new UnprocessableEntityException(`Line ${l.id} belum diisi jumlah box dikirim`);
        }
        return {
          picklistLineId: l.id,
          boxOrdered: l.boxOrdered,
          boxShipped,
          kanbans: ks.filter((k) => k.picklistLineId === l.id),
        };
      });

      const policy = await this.shortShipPolicy(tx, pl.vendorId, pl.arrivalTime);
      let result: ReturnType<typeof confirmShipment>;
      try {
        result = confirmShipment(domainLines, policy);
      } catch (e) {
        if (e instanceof ShipmentError) throw new UnprocessableEntityException(e.message);
        throw e;
      }

      const now = new Date();
      const ref = `${pl.picklistNo}-${pl.revision}`;
      const catatan = input.note?.trim();
      const note = catatan
        ? `${pl.note ? `${pl.note} | ` : ''}Supplier: ${catatan}`.slice(0, 255)
        : pl.note;
      await tx
        .update(picklistHeaders)
        .set({
          status: 'SHIPPED',
          shippedAt: now,
          eta: input.eta ? new Date(input.eta) : null,
          vehicleNo: input.vehicleNo?.trim() || null,
          note,
        })
        .where(eq(picklistHeaders.id, pl.id));

      for (const r of result.lines) {
        await tx
          .update(picklistLines)
          .set({ boxShipped: r.boxShipped, status: r.status })
          .where(eq(picklistLines.id, r.picklistLineId));
      }

      const shippedIds = result.lines.flatMap((r) => r.shippedKanbanIds);
      if (shippedIds.length > 0) {
        await tx.update(kanbans).set({ status: 'SHIPPED' }).where(inArray(kanbans.id, shippedIds));
        await tx.insert(kanbanEvents).values(
          shippedIds.map((kanbanId) => ({
            kanbanId,
            type: 'SHIPPED' as const,
            occurredAt: now,
            ref,
          })),
        );
      }
      if (result.cancelledKanbanIds.length > 0) {
        await tx
          .update(kanbans)
          .set({ status: 'CANCELLED' })
          .where(inArray(kanbans.id, result.cancelledKanbanIds));
        await tx.insert(kanbanEvents).values(
          result.cancelledKanbanIds.map((kanbanId) => ({
            kanbanId,
            type: 'CANCELLED' as const,
            occurredAt: now,
            ref,
          })),
        );
      }

      // REVISION: nomor sama, revisi+1, hanya line sisa; kanban sisa ikut pindah.
      let revision: { id: number; revision: number; lineCount: number } | null = null;
      if (result.revisionLines.length > 0) {
        const lineById = new Map(lines.map((l) => [l.id, l]));
        const revNo = pl.revision + 1;
        const revId = (
          await tx
            .insert(picklistHeaders)
            .values({
              plantId: pl.plantId,
              picklistNo: pl.picklistNo,
              revision: revNo,
              type: pl.type,
              vendorId: pl.vendorId,
              cutoffAt: pl.cutoffAt,
              deliveryDate: tambahHari(pl.deliveryDate, 1),
              arrivalTime: pl.arrivalTime,
              cycle: pl.cycle,
              status: 'ISSUED',
              note: `Revisi ${revNo} dari ${ref}: sisa yang belum terkirim`,
              createdById: pl.createdById,
            })
            .$returningId()
        )[0]!.id;
        for (const r of result.revisionLines) {
          const src = lineById.get(r.picklistLineId)!;
          const newLineId = (
            await tx
              .insert(picklistLines)
              .values({
                picklistId: revId,
                vendorPartId: src.vendorPartId,
                boxOrdered: r.boxes,
                qtyPerBox: src.qtyPerBox,
                pcs: r.boxes * src.qtyPerBox,
                // 6.6.4: revisi mewarisi nomor PO.
                sapPoNo: src.sapPoNo,
                sapPoItem: src.sapPoItem,
              })
              .$returningId()
          )[0]!.id;
          if (r.kanbanIds.length > 0) {
            await tx
              .update(kanbans)
              .set({ picklistLineId: newLineId })
              .where(inArray(kanbans.id, r.kanbanIds));
          }
        }
        revision = { id: revId, revision: revNo, lineCount: result.revisionLines.length };
        await writeAudit(tx, 'TT_PICKLIST_H', revId, 'CREATE_REVISION', actor.userId, null, {
          picklistNo: pl.picklistNo, revision: revNo, sourceId: pl.id,
          lines: result.revisionLines.map((line) => ({ picklistLineId: line.picklistLineId, boxes: line.boxes })),
        });
      }

      await writeAudit(tx, 'TT_PICKLIST_H', pl.id, 'CONFIRM_SHIPMENT', actor.userId,
        { ...pl, lines: domainLines.map((line) => ({
          picklistLineId: line.picklistLineId, boxOrdered: line.boxOrdered, kanbans: line.kanbans,
        })) },
        { ...pl, status: 'SHIPPED', shippedAt: now, eta: input.eta ?? null,
          vehicleNo: input.vehicleNo ?? null, note, policy,
          lines: result.lines.map((line) => ({ picklistLineId: line.picklistLineId,
            boxShipped: line.boxShipped, boxShort: line.boxShort, status: line.status })), revision });

      return {
        id: pl.id,
        picklistNo: pl.picklistNo,
        status: 'SHIPPED' as const,
        policy,
        short: result.short,
        lines: result.lines.map((r) => ({
          picklistLineId: r.picklistLineId,
          boxShipped: r.boxShipped,
          boxShort: r.boxShort,
          status: r.status,
        })),
        revision,
      };
    });

    if (hasil.revision) {
      await this.enqueueRender(hasil.revision.id);
      await this.enqueueNotice('PICKLIST_REVISED', hasil.revision.id);
    }
    return hasil;
  }

  /**
   * Kebijakan short shipment dari cutoff supplier yang jam kedatangannya sama
   * dengan picklist; bila tidak ketemu, cutoff aktif pertama; bila tidak ada
   * sama sekali, CARRY_OVER (bawaan kolom).
   */
  private async shortShipPolicy(tx: Transaction, vendorId: number, arrivalTime: string) {
    const rows = await tx
      .select({ arrivalTime: vendorCutoffs.arrivalTime, policy: vendorCutoffs.shortShipPolicy })
      .from(vendorCutoffs)
      .where(and(eq(vendorCutoffs.vendorId, vendorId), eq(vendorCutoffs.isActive, true)))
      .orderBy(asc(vendorCutoffs.cutoffTime));
    return (rows.find((r) => r.arrivalTime === arrivalTime) ?? rows[0])?.policy ?? 'CARRY_OVER';
  }

  async list(q: PicklistListQuery, scope: VendorScope) {
    // Scope dari token menang atas apa pun yang dikirim klien: bagi akun
    // supplier, saringan vendor di query string hanya boleh mempersempit
    // pilihannya sendiri, tidak pernah melebarkannya.
    const vendorId = scope ?? q.vendorId;
    const where = and(
      q.status ? eq(picklistHeaders.status, q.status) : undefined,
      vendorId ? eq(picklistHeaders.vendorId, vendorId) : undefined,
    );
    const [rows, totalRows] = await Promise.all([
      this.db
        .select({
          id: picklistHeaders.id,
          picklistNo: picklistHeaders.picklistNo,
          revision: picklistHeaders.revision,
          type: picklistHeaders.type,
          status: picklistHeaders.status,
          vendorId: picklistHeaders.vendorId,
          vendorName: vendors.name,
          deliveryDate: picklistHeaders.deliveryDate,
          arrivalTime: picklistHeaders.arrivalTime,
          cutoffAt: picklistHeaders.cutoffAt,
          downloadedAt: picklistHeaders.downloadedAt,
          shippedAt: picklistHeaders.shippedAt,
          createdAt: picklistHeaders.createdAt,
          lineCount: sql<number>`(select count(*) from ${picklistLines} where ${picklistLines.picklistId} = ${picklistHeaders.id})`,
          boxOrdered: sql<number>`(select coalesce(sum(${picklistLines.boxOrdered}), 0) from ${picklistLines} where ${picklistLines.picklistId} = ${picklistHeaders.id})`,
        })
        .from(picklistHeaders)
        .innerJoin(vendors, eq(picklistHeaders.vendorId, vendors.id))
        .where(where)
        .orderBy(desc(picklistHeaders.id))
        .limit(q.perPage)
        .offset((q.page - 1) * q.perPage),
      this.db.select({ value: count() }).from(picklistHeaders).where(where),
    ]);
    const total = totalRows[0]?.value ?? 0;
    return {
      data: rows.map((r) => ({
        ...r,
        lineCount: Number(r.lineCount),
        boxOrdered: Number(r.boxOrdered),
      })),
      meta: {
        page: q.page,
        perPage: q.perPage,
        total,
        totalPages: Math.max(1, Math.ceil(total / q.perPage)),
      },
    };
  }

  async get(id: number, scope: VendorScope) {
    const [header] = await this.db
      .select({
        id: picklistHeaders.id,
        picklistNo: picklistHeaders.picklistNo,
        revision: picklistHeaders.revision,
        type: picklistHeaders.type,
        status: picklistHeaders.status,
        vendorId: picklistHeaders.vendorId,
        vendorName: vendors.name,
        sapVendorNo: vendors.sapVendorNo,
        cutoffAt: picklistHeaders.cutoffAt,
        deliveryDate: picklistHeaders.deliveryDate,
        arrivalTime: picklistHeaders.arrivalTime,
        downloadedAt: picklistHeaders.downloadedAt,
        shippedAt: picklistHeaders.shippedAt,
        eta: picklistHeaders.eta,
        vehicleNo: picklistHeaders.vehicleNo,
        note: picklistHeaders.note,
        createdAt: picklistHeaders.createdAt,
      })
      .from(picklistHeaders)
      .innerJoin(vendors, eq(picklistHeaders.vendorId, vendors.id))
      // Kondisi vendor ikut di WHERE yang sama dengan id, bukan dicek setelah
      // barisnya terambil: picklist milik supplier lain menghasilkan baris
      // kosong, jadi jawabannya 404 dan bukan 403 yang justru mengonfirmasi
      // bahwa nomor itu ada.
      .where(
        and(eq(picklistHeaders.id, id), scope ? eq(picklistHeaders.vendorId, scope) : undefined),
      );
    if (!header) throw new NotFoundException('Picklist tidak ditemukan');

    const [lines, kanbanRows] = await Promise.all([
      this.db
        .select({
          id: picklistLines.id,
          vendorPartId: picklistLines.vendorPartId,
          partNo: parts.partNo,
          partName: parts.name,
          backNo: vendorParts.backNo,
          rack: vendorParts.rack,
          boxOrdered: picklistLines.boxOrdered,
          boxShipped: picklistLines.boxShipped,
          boxReceived: picklistLines.boxReceived,
          qtyPerBox: picklistLines.qtyPerBox,
          pcs: picklistLines.pcs,
          sapPoNo: picklistLines.sapPoNo,
          sapPoItem: picklistLines.sapPoItem,
          status: picklistLines.status,
        })
        .from(picklistLines)
        .innerJoin(vendorParts, eq(picklistLines.vendorPartId, vendorParts.id))
        .innerJoin(parts, eq(vendorParts.partId, parts.id))
        .where(eq(picklistLines.picklistId, id))
        .orderBy(asc(picklistLines.id)),
      this.db
        .select({
          id: kanbans.id,
          picklistLineId: kanbans.picklistLineId,
          serial: kanbans.serial,
          status: kanbans.status,
        })
        .from(kanbans)
        .innerJoin(picklistLines, eq(kanbans.picklistLineId, picklistLines.id))
        .where(eq(picklistLines.picklistId, id))
        .orderBy(asc(kanbans.serial)),
    ]);

    return {
      ...header,
      lines: lines.map((l) => ({
        ...l,
        kanbans: kanbanRows.filter((k) => k.picklistLineId === l.id),
      })),
    };
  }

  /**
   * F-29: unduhan pertama oleh supplier menandai picklist DOWNLOADED.
   *
   * UPDATE bersyarat, bukan baca-lalu-tulis. PDF picklist dan PDF kanban
   * hampir selalu diunduh beruntun dalam hitungan detik; dua request yang
   * sama-sama membaca status ISSUED akan menimpa DOWNLOADED_AT dengan waktu
   * yang lebih baru. Nol baris terpengaruh berarti sudah pernah diunduh —
   * keadaan normal, bukan galat.
   *
   * Status asal diambil dari tabel transisi di domain, bukan ditulis ulang di
   * sini (aturan repo 3).
   */
  async markDownloaded(id: number, vendorId: number): Promise<void> {
    const dariMana = (
      Object.keys(PICKLIST_TRANSITIONS) as Array<keyof typeof PICKLIST_TRANSITIONS>
    ).filter((dari) => PICKLIST_TRANSITIONS[dari].includes('DOWNLOADED'));
    if (dariMana.length === 0) return;

    await this.db
      .update(picklistHeaders)
      .set({ status: 'DOWNLOADED', downloadedAt: new Date() })
      .where(
        and(
          eq(picklistHeaders.id, id),
          eq(picklistHeaders.vendorId, vendorId),
          inArray(picklistHeaders.status, dariMana),
        ),
      );
  }

  /**
   * Cutoff pilihan PPIC, atau cutoff aktif paling pagi bila tidak dipilih.
   *
   * Seluruh jadwal supplier ikut dibaca, bukan hanya baris terpilih, karena
   * cycle adalah urutan kedatangan di antara jadwal itu (§14) dan ikut
   * tercetak di picklist maupun kanban (F-23, F-24).
   */
  private async resolveCutoff(tx: Transaction, vendorId: number, cutoffId?: number) {
    const rows = await tx
      .select({
        id: vendorCutoffs.id,
        cutoffTime: vendorCutoffs.cutoffTime,
        arrivalTime: vendorCutoffs.arrivalTime,
      })
      .from(vendorCutoffs)
      .where(and(eq(vendorCutoffs.vendorId, vendorId), eq(vendorCutoffs.isActive, true)))
      .orderBy(asc(vendorCutoffs.cutoffTime));

    const dipilih = cutoffId ? rows.find((r) => r.id === cutoffId) : rows[0];
    // rows sudah memuat arrivalTime; cycleOfCutoff yang memutuskan urutannya.
    if (!dipilih) {
      throw new BadRequestException(
        cutoffId
          ? 'Cutoff tidak ditemukan untuk supplier ini'
          : 'Supplier belum punya setting cutoff aktif (F-04)',
      );
    }
    return { ...dipilih, cycle: cycleOfCutoff(rows, dipilih.id) ?? 1 };
  }
}

/** Tanggal kalender YYYY-MM-DD + n hari, tanpa geser zona waktu. */
function tambahHari(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
