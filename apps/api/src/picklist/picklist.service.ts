import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ulid } from 'ulid';
import { randomUUID } from 'node:crypto';
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  count,
  ne,
  or,
  sql,
  vendors,
  plants,
  vendorParts,
  vendorCutoffs,
  parts,
  poHeaders,
  poLines,
  orderStandards,
  picklistHeaders,
  picklistLines,
  receiptHeaders,
  kanbans,
  kanbanEvents,
  stockMutations,
  holidays,
  orderQueues,
  queueAdjustments,
  type Database,
  type Transaction,
  poItemUsage,
} from '@ares/db';
import {
  pickPoItem,
  pickRecoveryPoItem,
  checkPoOpenQty,
  assertTransition,
  confirmShipment,
  overrideShippedBoxes,
  InvalidTransitionError,
  PICKLIST_TRANSITIONS,
  ShipmentError,
  assignCutoff,
  deliveryForCutoff,
  planPicklist,
  planClaim,
  ClaimError,
  type PoCandidate,
  type ShipmentLineInput,
} from '@ares/domain';
import type {
  ConfirmShipmentInput,
  CreateClaimInput,
  IssueManualPicklistInput,
  OverrideShipmentInput,
  PicklistListQuery,
  PicklistType,
  ShortShipPolicy,
} from '@ares/contracts';
import type { PicklistNoticeKind } from '../notify/notify.service';
import { NotifyService } from '../notify/notify.service';
import { closedCutoffs } from '../common/closed-cutoffs';
import { InjectDb } from '../db/db.module';
import { SequenceService } from '../common/sequence.service';
import { writeAudit } from '../common/audit';
import { QueueService } from '../queue/queue.service';
import { QUEUES, JOBS } from '../queue/queue.constants';
import { ManualOrderImportError, parseManualOrderWorkbook } from './manual-order-import';

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

export type AutoIssueResult =
  | {
      status: 'CREATED';
      id: number;
      publicId: string;
      picklistNo: string;
      lineCount: number;
      kanbanCount: number;
      queueCount: number;
    }
  | { status: 'BLOCKED'; reason: string; queueCount: number }
  | { status: 'SKIPPED'; reason: string; queueCount: number };

@Injectable()
export class PicklistService {
  private readonly logger = new Logger(PicklistService.name);

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly sequence: SequenceService,
    private readonly queue: QueueService,
    private readonly notify: NotifyService,
  ) {}

  /** F-17: upload template Excel diterjemahkan ke jalur order manual yang sama. */
  async importManualExcel(buffer: Buffer, actor: Actor) {
    let workbook;
    try {
      workbook = await parseManualOrderWorkbook(buffer);
    } catch (error) {
      if (error instanceof ManualOrderImportError) throw new BadRequestException(error.message);
      throw error;
    }

    const [vendor] = await this.db
      .select({ id: vendors.id })
      .from(vendors)
      .where(and(eq(vendors.sapVendorNo, workbook.sapVendorNo), eq(vendors.isActive, true)))
      .limit(1);
    if (!vendor) {
      throw new NotFoundException(`Supplier SAP ${workbook.sapVendorNo} tidak ditemukan atau nonaktif`);
    }

    const mappings = await this.db
      .select({
        vendorPartId: vendorParts.id,
        sapMaterialNo: parts.sapMaterialNo,
      })
      .from(vendorParts)
      .innerJoin(parts, eq(vendorParts.partId, parts.id))
      .where(and(
        eq(vendorParts.vendorId, vendor.id),
        eq(vendorParts.isActive, true),
        eq(parts.isActive, true),
        inArray(parts.sapMaterialNo, workbook.lines.map((line) => line.sapMaterialNo)),
      ));
    const mappingByMaterial = new Map(mappings.map((row) => [row.sapMaterialNo, row.vendorPartId]));
    const unknown = workbook.lines.filter((line) => !mappingByMaterial.has(line.sapMaterialNo));
    if (unknown.length > 0) {
      throw new UnprocessableEntityException(
        unknown.map((line) => `Baris ${line.row}: material ${line.sapMaterialNo} tidak aktif untuk supplier ini`).join('; '),
      );
    }


    return this.issueManual({
      vendorId: vendor.id,
      deliveryDate: workbook.deliveryDate,
      note: workbook.note,
      lines: workbook.lines.map((line) => ({
        vendorPartId: mappingByMaterial.get(line.sapMaterialNo)!,
        boxes: line.boxes,
      })),
    }, actor);
  }

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
      if (!vendor) {
        throw new NotFoundException('Supplier tidak ditemukan atau nonaktif');
      }
      const [orderPlant] = await tx
        .select({ code: plants.code })
        .from(plants)
        .where(and(eq(plants.id, actor.plantId), eq(plants.isActive, true)));
      if (!orderPlant) throw new NotFoundException('Plant Aisin akun tidak ditemukan atau nonaktif');

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
            eq(poLines.balanceVerified, true),
            eq(poLines.isActive, true),
            inArray(
              poLines.partId,
              vps.map((v) => v.partId),
            ),
          ),
        )
        .orderBy(asc(poLines.id))
        .for('update');

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
      const capacity = await this.poCapacityProblems(tx, resolved.map((r) => ({
        po: r.po!,
        newPcs: r.line.boxes * r.vp.qtyPerBox,
        partNo: r.vp.partNo,
        vendorPartId: r.vp.id,
      })));
      if (capacity.length > 0) {
        throw new UnprocessableEntityException(capacity.map((item) => item.reason).join('; '));
      }

      const now = new Date();
      const picklistNo = await this.sequence.nextOrder(tx, orderPlant.code, input.deliveryDate);
      const publicId = randomUUID();
      const picklistId = (
        await tx
          .insert(picklistHeaders)
          .values({
            publicId,
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

      // Satu kanban per box (F-22): ULID sebagai ID/isi QR, serial urut per part.
      const ref = `${picklistNo}-0`;
      let kanbanCount = 0;
      const kanbanRows: (typeof kanbans.$inferInsert)[] = [];
      const eventRows: (typeof kanbanEvents.$inferInsert)[] = [];
      for (const r of resolved) {
        let serial = 0;
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
          kanbanCount += 1;
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
        deliveryDate: input.deliveryDate, lines: input.lines, kanbanCount,
      });

      return {
        id: picklistId,
        publicId,
        picklistNo,
        revision: 0,
        lineCount: resolved.length,
        kanbanCount,
      };
    });

    await this.enqueueRender(hasil.id);
    await this.enqueueNotice('PICKLIST_ISSUED', hasil.id);
    return hasil;
  }

  /**
   * F-16: seluruh antrean OPEN satu supplier pada satu cutoff diproses dalam
   * satu transaksi. Lock pada baris antrean adalah kunci idempoten database:
   * retry setelah commit tidak menemukan baris OPEN dan tidak menerbitkan
   * picklist kedua (6.2.4).
   */
  async issueAutomatic(
    vendorId: number,
    cutoffAt: Date,
    actor: Actor,
    anomalyReason?: string,
  ): Promise<AutoIssueResult> {
    const hasil = await this.db.transaction(async (tx): Promise<AutoIssueResult> => {
      const rows = await tx
        .select({
          queueId: orderQueues.id,
          queuePcs: orderQueues.pcs,
          carryOverPcs: orderQueues.carryOverPcs,
          hold: orderQueues.hold,
          blockedReason: orderQueues.blockedReason,
          vendorPartId: vendorParts.id,
          vendorPartActive: vendorParts.isActive,
          qtyPerBox: vendorParts.qtyPerBox,
          poItemDefaultId: vendorParts.poItemDefaultId,
          partId: parts.id,
          partNo: parts.partNo,
           partActive: parts.isActive,
           vendorActive: vendors.isActive,
           vendorSapNo: vendors.sapVendorNo,
           vendorPlantId: vendors.plantId,
           vendorDeliveryDays: vendors.deliveryDays,
           plantCode: plants.code,
          standardKanban: orderStandards.standardKanban,
        })
        .from(orderQueues)
        .innerJoin(vendorParts, eq(orderQueues.vendorPartId, vendorParts.id))
        .innerJoin(parts, eq(vendorParts.partId, parts.id))
        .innerJoin(vendors, eq(vendorParts.vendorId, vendors.id))
        .innerJoin(plants, eq(vendors.plantId, plants.id))
        .leftJoin(
          orderStandards,
          and(
            eq(orderStandards.vendorPartId, vendorParts.id),
            eq(orderStandards.isActive, true),
          ),
        )
        .where(
          and(
            eq(orderQueues.status, 'OPEN'),
            eq(orderQueues.cutoffAt, cutoffAt),
            eq(vendorParts.vendorId, vendorId),
          ),
        )
        .orderBy(asc(orderQueues.id))
        .for('update');
      if (rows.length === 0) {
        return { status: 'SKIPPED', reason: 'Antrean sudah diproses', queueCount: 0 };
      }

      const block = async (
        reason: string,
        targetRows = rows,
      ): Promise<AutoIssueResult> => {
        const message = reason.slice(0, 1000);
        const now = new Date();
        for (const row of targetRows) {
          if (row.blockedReason === message) continue;
          await tx
            .update(orderQueues)
            .set({ blockedReason: message, blockedAt: now })
            .where(eq(orderQueues.id, row.queueId));
          await writeAudit(
            tx,
            'TT_ORDER_QUEUE',
            row.queueId,
            'CUTOFF_BLOCKED',
            actor.userId,
            { status: 'OPEN', blockedReason: row.blockedReason },
            { status: 'OPEN', blockedReason: message, cutoffAt },
          );
        }
        return { status: 'BLOCKED', reason: message, queueCount: rows.length };
      };

      const inactive = rows.filter((row) => !row.vendorActive || !row.vendorPartActive || !row.partActive);
      if (inactive.length > 0) {
        return block(`Master supplier/part nonaktif: ${inactive.map((row) => row.partNo).join(', ')}`);
      }
      if (!rows[0]?.vendorSapNo) return block('Nomor vendor SAP belum dipetakan');
      if (rows[0]?.vendorPlantId !== actor.plantId) {
        return block('Pabrik supplier tidak sesuai dengan pabrik antrean');
      }

      const [cutoffs, holidayRows] = await Promise.all([
        tx
          .select()
          .from(vendorCutoffs)
          .where(and(eq(vendorCutoffs.vendorId, vendorId), eq(vendorCutoffs.isActive, true))),
        tx.select({ date: holidays.date }).from(holidays).where(eq(holidays.isActive, true)),
      ]);
      const cutoff = cutoffs[0];
      if (!cutoff) return block('Supplier belum punya jadwal cutoff aktif (F-04)');

      const holidayDates = holidayRows.map((row) => row.date);
      // Cutoff tanpa jam: hari cutoff dihitung dari 00:00 WIB-nya sendiri.
      const delivery = deliveryForCutoff({
        cutoffAt,
        workdays: cutoff.workdays,
        leadDays: cutoff.leadDays,
        arrivalTime: cutoff.arrivalTime,
        holidayShift: cutoff.holidayShift,
        holidays: holidayDates,
        deliveryDays: rows[0]?.vendorDeliveryDays,
      });
      if ('error' in delivery) return block(delivery.error);

      const plans = planPicklist(
        rows.map((row) => ({
          vendorPartId: row.vendorPartId,
          queuePcs: row.queuePcs,
          carryOverPcs: row.carryOverPcs,
          qtyPerBox: row.qtyPerBox,
          hold: row.hold,
        })),
        cutoff.rounding,
      );
      const planByVendorPart = new Map(plans.map((plan) => [plan.vendorPartId, plan]));
      const anomalies = rows.filter((row) => {
        const plan = planByVendorPart.get(row.vendorPartId);
        return plan != null && !plan.held && row.standardKanban != null
          && plan.boxes !== row.standardKanban;
      });
      const cleanReason = anomalyReason?.trim();
      if (anomalies.length > 0 && (!cleanReason || cleanReason.length < 3)) {
        throw new BadRequestException(
          'Alasan wajib diisi karena jumlah order berbeda dari standar',
        );
      }
      const plannedRows = rows.filter((row) => (planByVendorPart.get(row.vendorPartId)?.boxes ?? 0) > 0);

      const needsNextQueue = rows.some((row) => {
        const plan = planByVendorPart.get(row.vendorPartId)!;
        return plan.held
          ? row.queuePcs !== 0 || row.carryOverPcs !== 0
          : plan.carryOverPcs !== 0;
      });
      const next = needsNextQueue
        ? assignCutoff(
            cutoffAt,
            cutoffs.map((row) => ({
              id: row.id,
              workdays: row.workdays,
              leadDays: row.leadDays,
              arrivalTime: row.arrivalTime,
              holidayShift: row.holidayShift,
            })),
            holidayDates,
            // Hari ini sedang ditutup; sisa dibawa ke hari cutoff berikutnya.
            new Set([cutoffAt.getTime()]),
          )
        : null;
      if (needsNextQueue && !next) return block('Cutoff berikutnya untuk carry-over tidak ditemukan');

      let created: Extract<AutoIssueResult, { status: 'CREATED' }> | null = null;
      if (plannedRows.length > 0) {
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
              eq(poHeaders.vendorId, vendorId),
              eq(poLines.balanceVerified, true),
              eq(poLines.isActive, true),
              inArray(
                poLines.partId,
                plannedRows.map((row) => row.partId),
              ),
            ),
          )
          .orderBy(asc(poLines.id))
          .for('update');
        const resolved = plannedRows.map((row) => ({
          row,
          plan: planByVendorPart.get(row.vendorPartId)!,
          po: pickPoItem(candidates, row.partId, delivery.deliveryDate, row.poItemDefaultId),
        }));
        const withoutPo = resolved.filter((item) => !item.po).map((item) => item.row.partNo);
        if (withoutPo.length > 0) {
          return block(
            `Tidak ada PO item aktif pada ${delivery.deliveryDate} untuk part: ${withoutPo.join(', ')}`,
          );
        }
        const capacity = await this.poCapacityProblems(tx, resolved.map((item) => ({
          po: item.po!,
          newPcs: item.plan.pcs,
          partNo: item.row.partNo,
          vendorPartId: item.row.vendorPartId,
        })));
        if (capacity.length > 0) {
          const blockedVendorParts = new Set(capacity.map((item) => item.vendorPartId));
          return block(
            capacity.map((item) => item.reason).join('; '),
            rows.filter((row) => blockedVendorParts.has(row.vendorPartId)),
          );
        }

        const now = new Date();
        const picklistNo = await this.sequence.nextOrder(tx, rows[0]!.plantCode, delivery.deliveryDate);
        const publicId = randomUUID();
        const picklistId = (
          await tx
            .insert(picklistHeaders)
            .values({
              publicId,
              plantId: actor.plantId,
              picklistNo,
              revision: 0,
              type: 'AUTO',
              vendorId,
              cutoffAt,
              deliveryDate: delivery.deliveryDate,
              arrivalTime: delivery.arrivalTime,
              cycle: 1,
              status: 'ISSUED',
              note:
                anomalies.length > 0
                  ? `Selisih dari standar: ${cleanReason}`.slice(0, 255)
                  : 'Terbit dari antrean konsumsi setelah dijalankan PPIC',
              createdById: actor.userId,
            })
            .$returningId()
        )[0]!.id;

        const kanbanRows: (typeof kanbans.$inferInsert)[] = [];
        const eventRows: (typeof kanbanEvents.$inferInsert)[] = [];
        let kanbanCount = 0;
        for (const item of resolved) {
          let serial = 0;
          const lineId = (
            await tx
              .insert(picklistLines)
              .values({
                picklistId,
                vendorPartId: item.row.vendorPartId,
                boxOrdered: item.plan.boxes,
                qtyPerBox: item.row.qtyPerBox,
                pcs: item.plan.pcs,
                sapPoNo: item.po!.sapPoNo,
                sapPoItem: item.po!.sapPoItem,
              })
              .$returningId()
          )[0]!.id;
          for (let i = 0; i < item.plan.boxes; i += 1) {
            const id = ulid();
            kanbanRows.push({ id, picklistLineId: lineId, serial: ++serial, status: 'PRINTED' });
            kanbanCount += 1;
            eventRows.push({
              kanbanId: id,
              type: 'PRINTED',
              userId: actor.userId,
              occurredAt: now,
              ref: `${picklistNo}-0`,
            });
          }
        }
        await tx.insert(kanbans).values(kanbanRows);
        await tx.insert(kanbanEvents).values(eventRows);
        await writeAudit(tx, 'TT_PICKLIST_H', picklistId, 'ISSUE_AUTO', actor.userId, null, {
          picklistNo,
          revision: 0,
          status: 'ISSUED',
          vendorId,
          cutoffAt,
          deliveryDate: delivery.deliveryDate,
          queueIds: rows.map((row) => row.queueId),
          lines: resolved.map((item) => ({
            vendorPartId: item.row.vendorPartId,
            boxes: item.plan.boxes,
            pcs: item.plan.pcs,
          })),
          kanbanCount,
          anomalyReason: anomalies.length > 0 ? cleanReason : null,
        });
        created = {
          status: 'CREATED',
          id: picklistId,
          publicId,
          picklistNo,
          lineCount: resolved.length,
          kanbanCount,
          queueCount: rows.length,
        };
      }

      for (const row of rows) {
        const plan = planByVendorPart.get(row.vendorPartId)!;
        const movePcs = plan.held ? row.queuePcs : 0;
        const moveCarry = plan.held ? row.carryOverPcs : plan.carryOverPcs;
        if (next && (movePcs !== 0 || moveCarry !== 0)) {
          await tx
            .insert(orderQueues)
            .values({
              vendorPartId: row.vendorPartId,
              cutoffAt: next.cutoffAt,
              pcs: movePcs,
              carryOverPcs: moveCarry,
              hold: plan.held,
            })
            .onDuplicateKeyUpdate({
              set: {
                pcs: sql`${orderQueues.pcs} + ${movePcs}`,
                carryOverPcs: sql`${orderQueues.carryOverPcs} + ${moveCarry}`,
                hold: sql`${orderQueues.hold} OR ${plan.held}`,
                updatedAt: new Date(),
              },
            });
        }
        await tx
          .update(orderQueues)
          .set({
            status: 'CLOSED',
            carryOverPcs: plan.carryOverPcs,
            blockedReason: null,
            blockedAt: null,
          })
          .where(eq(orderQueues.id, row.queueId));
        await writeAudit(
          tx,
          'TT_ORDER_QUEUE',
          row.queueId,
          'CUTOFF_CLOSE',
          actor.userId,
          {
            status: 'OPEN',
            pcs: row.queuePcs,
            carryOverPcs: row.carryOverPcs,
            hold: row.hold,
            blockedReason: row.blockedReason,
          },
          {
            status: 'CLOSED',
            boxes: plan.boxes,
            orderedPcs: plan.pcs,
            carryOverPcs: plan.carryOverPcs,
            nextCutoffAt: movePcs !== 0 || moveCarry !== 0 ? next?.cutoffAt : null,
          },
        );
      }

      return created ?? {
        status: 'SKIPPED',
        reason: 'Tidak ada antrean yang mencapai satu box; sisa dibawa ke cutoff berikutnya',
        queueCount: rows.length,
      };
    });

    if (hasil.status === 'CREATED') {
      await this.enqueueRender(hasil.id);
      await this.enqueueNotice('PICKLIST_ISSUED', hasil.id);
    }
    return hasil;
  }

  /** F-31: email ke akun vendor lewat worker; gagal mengantre hanya dicatat, order tetap terbit. */
  private async enqueueNotice(kind: PicklistNoticeKind, picklistId: number): Promise<void> {
    try {
      await this.notify.enqueuePicklistNotice(kind, picklistId);
    } catch (err) {
      const pesan = err instanceof Error ? err.message : String(err);
      this.logger.error(`picklist ${picklistId}: email ${kind} gagal diantre: ${pesan}`);
    }
  }

  /** F-31: izin picklist.issue diperiksa controller; pabrik tetap disaring di DB. */
  async resendNotice(id: number, actor: Actor) {
    const [pl] = await this.db.select({ revision: picklistHeaders.revision }).from(picklistHeaders)
      .where(and(eq(picklistHeaders.id, id), eq(picklistHeaders.plantId, actor.plantId)));
    if (!pl) throw new NotFoundException('Order Sheet tidak ditemukan');
    return this.notify.enqueuePicklistNotice(pl.revision > 0 ? 'PICKLIST_REVISED' : 'PICKLIST_ISSUED', id, actor);
  }

  /**
   * F-27: PDF picklist dan kanban dirender worker, bukan di dalam request.
   *
   * Kegagalan mengantre sengaja tidak dilempar ke pemanggil. Picklist-nya
   * sudah tersimpan beserta nomornya, dan nomor tidak pernah dipakai ulang
   * (6.6.2) — membatalkan order yang sudah sempurna hanya karena Redis mati
   * jauh lebih merugikan daripada PDF yang terlambat. Job bisa diulang.
   */
  /**
   * Setelah recovery/claim commit: render PDF-nya dan kabari supplier.
   * Dipanggil modul lain (receiving) yang menerbitkan Order Sheet lewat
   * `createRecovery`, di luar transaksi.
   */
  async publishOrder(
    picklistId: number,
    kind: PicklistNoticeKind = 'PICKLIST_ISSUED',
  ): Promise<void> {
    await this.enqueueRender(picklistId);
    await this.enqueueNotice(kind, picklistId);
  }

  private async enqueueRender(
    picklistId: number,
    job: typeof JOBS.RENDER_PDF | typeof JOBS.RENDER_DELIVERY_SHEET = JOBS.RENDER_PDF,
  ): Promise<void> {
    try {
      await this.queue.add(QUEUES.DOCUMENT, job, { picklistId });
    } catch (err) {
      const pesan = err instanceof Error ? err.message : String(err);
      this.logger.error(`picklist ${picklistId}: ${job} gagal diantre: ${pesan}`);
    }
  }

  /**
   * F-20 / 6.6.3: hanya ISSUED atau DOWNLOADED yang bisa dibatalkan; nomor
   * tidak dipakai ulang (6.6.2). Kanban PRINTED ikut CANCELLED (PRD §3).
   * Picklist AUTO mengembalikan pcs yang sempat diorder ke cutoff efektif
   * berikutnya di transaksi yang sama.
   */
  async cancel(id: number, reason: string, actor: Actor, scope: VendorScope) {
    return this.db.transaction(async (tx) => {
      const [pl] = await tx
        .select()
        .from(picklistHeaders)
        .where(
          and(
            eq(picklistHeaders.id, id),
            eq(picklistHeaders.plantId, actor.plantId),
            scope ? eq(picklistHeaders.vendorId, scope) : undefined,
          ),
        )
        .for('update');
      if (!pl) throw new NotFoundException('Order Sheet tidak ditemukan');
      try {
        assertTransition('picklist', pl.status, 'CANCELLED');
      } catch (e) {
        if (e instanceof InvalidTransitionError) throw new ConflictException(e.message);
        throw e;
      }

      const now = new Date();
      const lines = await tx
        .select({
          vendorPartId: picklistLines.vendorPartId,
          pcs: picklistLines.pcs,
        })
        .from(picklistLines)
        .where(eq(picklistLines.picklistId, id));
      const returned: Array<{ queueId: number; vendorPartId: number; pcs: number; cutoffAt: Date }> = [];
      if (pl.type === 'AUTO' && lines.length > 0) {
        const [cutoffs, holidayRows] = await Promise.all([
          tx.select().from(vendorCutoffs).where(and(
            eq(vendorCutoffs.vendorId, pl.vendorId),
            eq(vendorCutoffs.isActive, true),
          )),
          tx.select({ date: holidays.date }).from(holidays).where(eq(holidays.isActive, true)),
        ]);
        const next = assignCutoff(now, cutoffs.map((row) => ({
          id: row.id,
          workdays: row.workdays,
          leadDays: row.leadDays,
          arrivalTime: row.arrivalTime,
          holidayShift: row.holidayShift,
        })), holidayRows.map((row) => row.date), await closedCutoffs(tx, pl.vendorId, now));
        if (!next) {
          throw new UnprocessableEntityException(
            'Cutoff berikutnya tidak ditemukan; Order Sheet AUTO belum bisa dibatalkan',
          );
        }
        for (const line of lines) {
          await tx.insert(orderQueues).values({
            vendorPartId: line.vendorPartId,
            cutoffAt: next.cutoffAt,
            pcs: line.pcs,
          }).onDuplicateKeyUpdate({ set: {
            pcs: sql`${orderQueues.pcs} + ${line.pcs}`,
            updatedAt: new Date(),
          } });
          const [queue] = await tx.select().from(orderQueues).where(and(
            eq(orderQueues.vendorPartId, line.vendorPartId),
            eq(orderQueues.cutoffAt, next.cutoffAt),
          )).limit(1);
          if (!queue) throw new Error('Antrean pembatalan Order Sheet gagal dibuat');
          const returnReason = `Pembatalan ${pl.picklistNo}-${pl.revision}: ${reason}`.slice(0, 255);
          await tx.insert(queueAdjustments).values({
            queueId: queue.id,
            deltaPcs: line.pcs,
            reason: returnReason,
            userId: actor.userId,
          });
          await writeAudit(tx, 'TT_ORDER_QUEUE', queue.id, 'RETURN_CANCELLED', actor.userId,
            { pcs: queue.pcs - line.pcs },
            { pcs: queue.pcs, source: `${pl.picklistNo}-${pl.revision}`, returnedPcs: line.pcs });
          returned.push({ queueId: queue.id, vendorPartId: line.vendorPartId, pcs: line.pcs, cutoffAt: next.cutoffAt });
        }
      }

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
        ...pl, status: 'CANCELLED', note, kanbanCancelled: ks.map((k) => k.id), reason, returned,
      });

      return { id, status: 'CANCELLED' as const, kanbanCount: ks.length };
    });
  }

  /**
   * F-30 / 6.3: konfirmasi kirim oleh supplier — satu transaksi.
   *
   * Header → SHIPPED (ISSUED lewat DOWNLOADED dulu: supplier yang mengonfirmasi
   * jelas sudah memegang dokumennya), kanban yang dikirim → SHIPPED + event,
   * line kurang → SHORT. Sisa selalu membuat header recovery berikutnya dengan
   * base order sama dan RR +1; kanban sisa pindah dan tetap PRINTED (F-25).
   * Setelah SHIPPED tidak bisa diubah lagi dari portal (6.3.4).
   *
   * ponytail: tanggal kirim revisi = tanggal kirim asal + 1 hari kalender;
   * hari kerja & libur (6.2) menyusul bersama job cutoff fase 2.
   */
  async confirmShipment(
    id: number,
    input: ConfirmShipmentInput,
    actor: { vendorId: number; userId: number; plantId?: number },
  ) {
    const hasil = await this.db.transaction(async (tx) => {
      const [pl] = await tx
        .select()
        .from(picklistHeaders)
        .where(and(
          eq(picklistHeaders.id, id),
          eq(picklistHeaders.vendorId, actor.vendorId),
          actor.plantId ? eq(picklistHeaders.plantId, actor.plantId) : undefined,
        ))
        .for('update');
      if (!pl) throw new NotFoundException('Order Sheet tidak ditemukan');

      // F-29: supplier wajib mengunduh Order Sheet dan kanban sebelum
      // konfirmasi kirim — kanban yang ditempel di box berasal dari unduhan itu.
      if (pl.status === 'ISSUED') {
        throw new ConflictException('Unduh Order Sheet dan kanban dulu sebelum konfirmasi kirim');
      }
      try {
        assertTransition('picklist', pl.status, 'SHIPPED');
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

      // Keputusan bisnis 2026-09-24: kekurangan selalu menjadi Order Sheet
      // recovery dengan base order yang sama dan RR bertambah 01, 02, ...
      const policy: ShortShipPolicy = 'REVISION';
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

      const carryOver: never[] = [];

      // REVISION: nomor sama, revisi+1, hanya line sisa; kanban sisa ikut pindah.
      // Order claim dihitung per pcs dan diterima tanpa scan: kekurangan kirim
      // cukup membuat claim tetap PARTIAL, bukan melahirkan recovery baru.
      let revision: { id: number; publicId: string; revision: number; lineCount: number } | null = null;
      if (result.revisionLines.length > 0 && pl.type !== 'CLAIM') {
        revision = await this.createRecovery(
          tx,
          pl,
          result.revisionLines.map((r) => ({
            sourceLineId: r.picklistLineId,
            boxes: r.boxes,
            kanbanIds: r.kanbanIds,
          })),
          { note: `Revisi ${pl.revision + 1} dari ${ref}: sisa yang belum terkirim`, actorUserId: actor.userId },
        );
      }

      await writeAudit(tx, 'TT_PICKLIST_H', pl.id, 'CONFIRM_SHIPMENT', actor.userId,
        { ...pl, lines: domainLines.map((line) => ({
          picklistLineId: line.picklistLineId, boxOrdered: line.boxOrdered, kanbans: line.kanbans,
        })) },
        { ...pl, status: 'SHIPPED', shippedAt: now, eta: input.eta ?? null,
          vehicleNo: input.vehicleNo ?? null, note, policy,
          lines: result.lines.map((line) => ({ picklistLineId: line.picklistLineId,
            boxShipped: line.boxShipped, boxShort: line.boxShort, status: line.status })), revision, carryOver });

      return {
        id: pl.id,
        publicId: pl.publicId,
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
        carryOver,
      };
    });

    // F-30: Delivery Sheet terbit setelah konfirmasi; barcode-nya membuka sesi scan (F-34).
    await this.enqueueRender(hasil.id, JOBS.RENDER_DELIVERY_SHEET);
    if (hasil.revision) {
      await this.enqueueRender(hasil.revision.id);
      await this.enqueueNotice('PICKLIST_REVISED', hasil.revision.id);
    }
    return hasil;
  }

  /** 6.3.4: PPIC mengoreksi BOX_SHIPPED setelah SHIPPED, sebelum sesi scan dibuat. */
  async overrideShipment(id: number, input: OverrideShipmentInput, actor: Actor) {
    const hasil = await this.db.transaction(async (tx) => {
      const [pl] = await tx.select().from(picklistHeaders)
        .where(and(eq(picklistHeaders.id, id), eq(picklistHeaders.plantId, actor.plantId)))
        .for('update');
      if (!pl) throw new NotFoundException('Order Sheet tidak ditemukan');
      if (pl.status !== 'SHIPPED') {
        throw new ConflictException('Jumlah kirim hanya bisa dikoreksi saat Order Sheet berstatus SHIPPED');
      }
      const [session] = await tx.select({ id: receiptHeaders.id }).from(receiptHeaders)
        .where(eq(receiptHeaders.picklistId, id)).limit(1).for('update');
      if (session) throw new ConflictException('Jumlah kirim tidak bisa diubah setelah sesi scan dibuka');

      const [laterRevision] = await tx.select({ id: picklistHeaders.id }).from(picklistHeaders)
        .where(and(
          eq(picklistHeaders.picklistNo, pl.picklistNo),
          sql`${picklistHeaders.revision} > ${pl.revision}`,
          inArray(picklistHeaders.status, ['ISSUED', 'DOWNLOADED', 'SHIPPED', 'PARTIAL']),
        )).limit(1).for('update');
      if (laterRevision) {
        throw new ConflictException('Order Sheet sudah memiliki revisi aktif; koreksi jumlah kirim pada revisi tersebut');
      }

      const lines = await tx.select({
        id: picklistLines.id,
        vendorPartId: picklistLines.vendorPartId,
        boxOrdered: picklistLines.boxOrdered,
        boxShipped: picklistLines.boxShipped,
        qtyPerBox: picklistLines.qtyPerBox,
        sapPoNo: picklistLines.sapPoNo,
        sapPoItem: picklistLines.sapPoItem,
      }).from(picklistLines).where(eq(picklistLines.picklistId, id))
        .orderBy(asc(picklistLines.id)).for('update');
      const requested = new Map(input.lines.map((line) => [line.picklistLineId, line.boxShipped]));
      if (requested.size !== lines.length || lines.some((line) => !requested.has(line.id))) {
        throw new UnprocessableEntityException('Semua line Order Sheet wajib diisi untuk koreksi jumlah kirim');
      }
      const result = (() => {
        try {
          return overrideShippedBoxes(lines.map((line) => ({
            picklistLineId: line.id,
            boxOrdered: line.boxOrdered,
            boxShipped: requested.get(line.id)!,
          })));
        } catch (error) {
          if (error instanceof ShipmentError) throw new UnprocessableEntityException(error.message);
          throw error;
        }
      })();

      const lineIds = lines.map((line) => line.id);
      const kanbanRows = lineIds.length ? await tx.select({
        id: kanbans.id,
        picklistLineId: kanbans.picklistLineId,
        serial: kanbans.serial,
        status: kanbans.status,
      }).from(kanbans).where(inArray(kanbans.picklistLineId, lineIds))
        .orderBy(asc(kanbans.serial)).for('update') : [];
      const policy: ShortShipPolicy = 'REVISION';
      const now = new Date();
      const ref = `${pl.picklistNo}-${pl.revision}`;
      const lineById = new Map(lines.map((line) => [line.id, line]));

      for (const row of result) {
        const line = lineById.get(row.picklistLineId)!;
        const own = kanbanRows.filter((kanban) => kanban.picklistLineId === line.id);
        if (own.length !== line.boxOrdered) {
          throw new ConflictException(`Kanban line ${line.id} sudah dipindah ke revisi; koreksi dibatalkan`);
        }
        for (let index = 0; index < own.length; index += 1) {
          const kanban = own[index]!;
          const status = index < row.boxShipped
            ? 'SHIPPED' as const
            : 'PRINTED' as const;
          if (kanban.status === status) continue;
          await tx.update(kanbans).set({ status }).where(eq(kanbans.id, kanban.id));
          await tx.insert(kanbanEvents).values({
            kanbanId: kanban.id,
            type: status,
            userId: actor.userId,
            occurredAt: now,
            ref,
          });
        }
        await tx.update(picklistLines).set({ boxShipped: row.boxShipped, status: row.status })
          .where(eq(picklistLines.id, line.id));

      }

      let revision: { id: number; publicId: string; revision: number; lineCount: number } | null = null;
      const short = result.filter((row) => row.boxShort > 0);
      if (policy === 'REVISION' && short.length > 0) {
        revision = await this.createRecovery(
          tx,
          pl,
          short.map((row) => ({
            sourceLineId: row.picklistLineId,
            boxes: row.boxShort,
            kanbanIds: kanbanRows
              .filter((kanban) => kanban.picklistLineId === row.picklistLineId)
              .sort((a, b) => a.serial - b.serial)
              .slice(row.boxShipped)
              .map((kanban) => kanban.id),
          })),
          {
            note: `Revisi ${pl.revision + 1} dari ${ref}: koreksi PPIC — ${input.reason}`,
            actorUserId: actor.userId,
            createdById: actor.userId,
          },
        );
      }

      await writeAudit(tx, 'TT_PICKLIST_H', pl.id, 'OVERRIDE_SHIPMENT', actor.userId,
        { status: pl.status, lines: lines.map((line) => ({ id: line.id, boxShipped: line.boxShipped })) },
        { status: pl.status, reason: input.reason, lines: result, revision });
      return { id: pl.id, publicId: pl.publicId, status: pl.status, lines: result, revision };
    });
    // Qty kirim berubah → Delivery Sheet dicetak ulang dengan angka koreksi.
    await this.enqueueRender(hasil.id, JOBS.RENDER_DELIVERY_SHEET);
    if (hasil.revision) {
      await this.enqueueRender(hasil.revision.id);
      await this.enqueueNotice('PICKLIST_REVISED', hasil.revision.id);
    }
    return hasil;
  }



  /**
   * Order Sheet claim (barang rusak ketahuan setelah diterima).
   *
   * Nomornya `claim-<nomor order>` dengan running number sendiri, qty-nya
   * dalam satuan kanban (box) seperti order lain, dan tidak punya kartu
   * kanban — penerimaannya nanti tanpa scan dan tidak diangkat ke SAP karena
   * order asal sudah ter-GR penuh.
   *
   * Barang rusak dikembalikan ke supplier, jadi stok WH turun sekarang; stok
   * naik lagi saat barang gantinya diterima.
   */
  async createClaim(sourceId: number, input: CreateClaimInput, actor: Actor) {
    const hasil = await this.db.transaction(async (tx) => {
      const [source] = await tx
        .select()
        .from(picklistHeaders)
        .where(and(
          eq(picklistHeaders.id, sourceId),
          actor.plantId ? eq(picklistHeaders.plantId, actor.plantId) : undefined,
        ))
        .for('update');
      if (!source) throw new NotFoundException('Order Sheet tidak ditemukan');
      if (source.type === 'CLAIM') {
        throw new ConflictException('Order claim tidak bisa diklaim lagi');
      }
      if (!['PARTIAL', 'COMPLETE'].includes(source.status)) {
        throw new ConflictException('Claim hanya untuk order yang barangnya sudah diterima');
      }

      const lines = await tx
        .select({
          id: picklistLines.id,
          vendorPartId: picklistLines.vendorPartId,
          qtyPerBox: picklistLines.qtyPerBox,
          boxReceived: picklistLines.boxReceived,
          sapPoNo: picklistLines.sapPoNo,
          sapPoItem: picklistLines.sapPoItem,
          partId: vendorParts.partId,
        })
        .from(picklistLines)
        .innerJoin(vendorParts, eq(picklistLines.vendorPartId, vendorParts.id))
        .where(eq(picklistLines.picklistId, source.id))
        .orderBy(asc(picklistLines.id));

      // Box yang sudah diklaim dari tiap line, dari claim yang belum dibatalkan.
      const claimed = lines.length
        ? await tx
            .select({
              claimOfLineId: picklistLines.claimOfLineId,
              box: sql<number>`COALESCE(SUM(${picklistLines.boxOrdered}), 0)`,
            })
            .from(picklistLines)
            .innerJoin(picklistHeaders, eq(picklistLines.picklistId, picklistHeaders.id))
            .where(and(
              inArray(picklistLines.claimOfLineId, lines.map((line) => line.id)),
              ne(picklistHeaders.status, 'CANCELLED'),
            ))
            .groupBy(picklistLines.claimOfLineId)
        : [];
      const claimedByLine = new Map(claimed.map((row) => [Number(row.claimOfLineId), Number(row.box)]));

      let planned: ReturnType<typeof planClaim>;
      try {
        planned = planClaim(
          lines.map((line) => ({
            picklistLineId: line.id,
            qtyPerBox: line.qtyPerBox,
            boxReceived: line.boxReceived,
            boxClaimed: claimedByLine.get(line.id) ?? 0,
          })),
          input.lines,
        );
      } catch (error) {
        if (error instanceof ClaimError) throw new UnprocessableEntityException(error.message);
        throw error;
      }

      const [plant] = await tx
        .select({ code: plants.code })
        .from(plants)
        .where(eq(plants.id, source.plantId));
      if (!plant) throw new NotFoundException('Pabrik order ini tidak ditemukan');

      const now = new Date();
      const deliveryDate = tambahHari(hariIni(), 1);
      const picklistNo = await this.sequence.nextClaimOrder(tx, plant.code, deliveryDate);
      const publicId = randomUUID();
      const id = (
        await tx
          .insert(picklistHeaders)
          .values({
            publicId,
            plantId: source.plantId,
            picklistNo,
            revision: 0,
            type: 'CLAIM',
            vendorId: source.vendorId,
            cutoffAt: now,
            deliveryDate,
            arrivalTime: source.arrivalTime,
            cycle: 1,
            status: 'ISSUED',
            claimOfPicklistId: source.id,
            note: `Claim dari ${source.picklistNo}: ${input.reason}`.slice(0, 255),
            createdById: actor.userId,
          })
          .$returningId()
      )[0]!.id;

      const lineById = new Map(lines.map((line) => [line.id, line]));
      for (const row of planned) {
        const src = lineById.get(row.picklistLineId)!;
        const claimLineId = (
          await tx
            .insert(picklistLines)
            .values({
              picklistId: id,
              vendorPartId: src.vendorPartId,
              boxOrdered: row.boxOrdered,
              qtyPerBox: src.qtyPerBox,
              pcs: row.pcs,
              // Disalin sebagai keterangan; claim tidak pernah diangkat ke SAP.
              sapPoNo: src.sapPoNo,
              sapPoItem: src.sapPoItem,
              claimOfLineId: src.id,
            })
            .$returningId()
        )[0]!.id;
        // Barang rusak keluar dari gudang menuju supplier.
        await tx.insert(stockMutations).values({
          plantId: source.plantId,
          partId: src.partId,
          sloc: process.env.SAP_SLOC ?? 'WH00',
          deltaPcs: -row.pcs,
          type: 'ADJUST',
          refTable: 'TT_PICKLIST_L',
          refId: claimLineId,
          note: `Barang rusak dikembalikan ke supplier (${picklistNo})`.slice(0, 255),
          userId: actor.userId,
          occurredAt: now,
        });
      }

      await writeAudit(tx, 'TT_PICKLIST_H', id, 'CREATE_CLAIM', actor.userId, null, {
        picklistNo, sourceId: source.id, sourceNo: source.picklistNo,
        reason: input.reason, lines: planned,
      });

      return {
        id,
        publicId,
        picklistNo,
        deliveryDate,
        lines: planned,
        source: { id: source.id, publicId: source.publicId, picklistNo: source.picklistNo },
      };
    });

    await this.publishOrder(hasil.id);
    return hasil;
  }

  /**
   * Menerbitkan Order Sheet recovery: nomor sama, RR + 1, hanya berisi sisa.
   *
   * Satu jalur untuk ketiga pemicunya — supplier konfirmasi kirim kurang (6.3),
   * koreksi PPIC (6.3.4), dan sesi scan ditutup dengan box kurang (6.5.2).
   * Dipanggil di dalam transaksi pemanggil supaya order asal dan recovery-nya
   * selalu commit bersama.
   */
  async createRecovery(
    tx: Transaction,
    source: RecoverySource,
    items: ReadonlyArray<{ sourceLineId: number; boxes: number; kanbanIds: readonly string[] }>,
    opts: { note: string; actorUserId: number; createdById?: number | null; reissueKanban?: boolean },
  ): Promise<{ id: number; publicId: string; revision: number; lineCount: number }> {
    const sourceLineIds = items.map((item) => item.sourceLineId);
    const lines = await tx
      .select({
        id: picklistLines.id,
        vendorPartId: picklistLines.vendorPartId,
        qtyPerBox: picklistLines.qtyPerBox,
        sapPoNo: picklistLines.sapPoNo,
        sapPoItem: picklistLines.sapPoItem,
      })
      .from(picklistLines)
      .where(inArray(picklistLines.id, sourceLineIds));
    const lineById = new Map(lines.map((line) => [line.id, line]));

    const deliveryDate = tambahHari(source.deliveryDate, 1);
    const recoveryPos = await this.resolveRecoveryPos(
      tx,
      source.vendorId,
      deliveryDate,
      items.map((item) => ({ ...lineById.get(item.sourceLineId)!, boxes: item.boxes })),
    );

    const revision = source.revision + 1;
    const publicId = randomUUID();
    const id = (
      await tx
        .insert(picklistHeaders)
        .values({
          publicId,
          plantId: source.plantId,
          picklistNo: source.picklistNo,
          revision,
          type: source.type,
          vendorId: source.vendorId,
          cutoffAt: source.cutoffAt,
          deliveryDate,
          arrivalTime: source.arrivalTime,
          cycle: source.cycle,
          status: 'ISSUED',
          note: opts.note.slice(0, 255),
          createdById: opts.createdById ?? source.createdById,
        })
        .$returningId()
    )[0]!.id;

    const now = new Date();
    for (const item of items) {
      const src = lineById.get(item.sourceLineId)!;
      const newLineId = (
        await tx
          .insert(picklistLines)
          .values({
            picklistId: id,
            vendorPartId: src.vendorPartId,
            boxOrdered: item.boxes,
            qtyPerBox: src.qtyPerBox,
            pcs: item.boxes * src.qtyPerBox,
            sapPoNo: recoveryPos.get(src.id)!.sapPoNo,
            sapPoItem: recoveryPos.get(src.id)!.sapPoItem,
          })
          .$returningId()
      )[0]!.id;
      if (item.kanbanIds.length > 0) {
        await tx
          .update(kanbans)
          .set({
            picklistLineId: newLineId,
            // Kartu yang sudah ditandai hilang dipakai lagi di recovery; tanpa
            // dikembalikan ke PRINTED kartunya tidak bisa discan lagi (6.4).
            ...(opts.reissueKanban ? { status: 'PRINTED' as const, receiptId: null } : {}),
          })
          .where(inArray(kanbans.id, [...item.kanbanIds]));
        if (opts.reissueKanban) {
          await tx.insert(kanbanEvents).values(
            item.kanbanIds.map((kanbanId) => ({
              kanbanId,
              type: 'PRINTED' as const,
              userId: opts.actorUserId,
              occurredAt: now,
              ref: `${source.picklistNo}-${revision}`,
            })),
          );
        }
      }
    }

    await writeAudit(tx, 'TT_PICKLIST_H', id, 'CREATE_REVISION', opts.actorUserId, null, {
      picklistNo: source.picklistNo,
      revision,
      sourceId: source.id,
      note: opts.note,
      lines: items.map((item) => ({ picklistLineId: item.sourceLineId, boxes: item.boxes })),
    });

    return { id, publicId, revision, lineCount: items.length };
  }

  /** PO dikunci dan kapasitas diperiksa sebelum recovery diterbitkan, dalam transaksi asal. */
  private async resolveRecoveryPos(tx: Transaction, vendorId: number, deliveryDate: string,
    lines: Array<{ id: number; vendorPartId: number; qtyPerBox: number; boxes: number; sapPoNo: string; sapPoItem: string }>,
  ): Promise<Map<number, PoCandidate>> {
    const vps = await tx.select({ id: vendorParts.id, partId: vendorParts.partId, partNo: parts.partNo })
      .from(vendorParts).innerJoin(parts, eq(parts.id, vendorParts.partId))
      .where(and(eq(vendorParts.vendorId, vendorId), inArray(vendorParts.id, lines.map((line) => line.vendorPartId))));
    const candidates = vps.length ? await tx.select({
      poLineId: poLines.id, sapPoNo: poHeaders.sapPoNo, sapPoItem: poLines.item,
      partId: poLines.partId, openQty: poLines.openQty, validFrom: poHeaders.validFrom, validTo: poHeaders.validTo,
    }).from(poLines).innerJoin(poHeaders, eq(poHeaders.id, poLines.poId))
      .where(and(eq(poHeaders.vendorId, vendorId), eq(poLines.balanceVerified, true), eq(poLines.isActive, true), inArray(poLines.partId, vps.map((vp) => vp.partId))))
      .orderBy(asc(poLines.id)).for('update') : [];
    const resolved = lines.map((line) => {
      const vp = vps.find((row) => row.id === line.vendorPartId);
      const po = vp && pickRecoveryPoItem(candidates, vp.partId, deliveryDate, line);
      if (!po) throw new UnprocessableEntityException(
        `PO bulan ${deliveryDate.slice(0, 7)} belum tersedia untuk part ${vp?.partNo ?? line.vendorPartId}. Recovery belum diterbitkan; lengkapi PO bulan pengiriman.`,
      );
      return { line, po, partNo: vp!.partNo };
    });
    const problems = await this.poCapacityProblems(tx, resolved.map(({ line, po, partNo }) => ({
      po, partNo, newPcs: line.boxes * line.qtyPerBox, vendorPartId: line.vendorPartId,
    })));
    if (problems.length) throw new UnprocessableEntityException(problems.map((problem) => problem.reason).join('; '));
    return new Map(resolved.map(({ line, po }) => [line.id, po]));
  }

  /**
   * F-19: pcs yang sudah dipesan ARES per PO item + pcs baru tidak boleh melewati
   * qty PO (OPEN_QTY hasil tarik bulanan).
   * Baris PO sudah dikunci pemanggil, jadi penerbitan manual dan cutoff yang
   * berjalan bersamaan tidak dapat sama-sama memakai sisa kapasitas terakhir.
   */
  private async poCapacityProblems(
    tx: Transaction,
    requested: Array<{
      po: PoCandidate;
      newPcs: number;
      partNo: string;
      vendorPartId?: number;
    }>,
  ): Promise<Array<{ reason: string; vendorPartId?: number }>> {
    if (requested.length === 0) return [];
    const outstanding = await poItemUsage(tx, [...new Set(requested.map((row) => row.po.sapPoNo))]);
    const problems: Array<{ reason: string; vendorPartId?: number }> = [];
    for (const row of requested) {
      const key = `${row.po.sapPoNo}:${row.po.sapPoItem}`;
      const current = outstanding.get(key) ?? 0;
      const decision = checkPoOpenQty({
        openQty: row.po.openQty,
        orderedPcs: current,
        newPcs: row.newPcs,
      });
      if (!decision.allowed) {
        problems.push({
          vendorPartId: row.vendorPartId,
          reason: `PO_OPEN_QTY · ${row.partNo} · PO ${row.po.sapPoNo}/${row.po.sapPoItem}: ` +
            `sudah dipesan ${current} + baru ${row.newPcs} > qty PO ${row.po.openQty} (sisa ${decision.availablePcs})`,
        });
      } else {
        outstanding.set(key, decision.projectedPcs);
      }
    }
    return problems;
  }

  async list(q: PicklistListQuery, scope: VendorScope, plantId?: number) {
    // Scope dari token menang atas apa pun yang dikirim klien: bagi akun
    // supplier, saringan vendor di query string hanya boleh mempersempit
    // pilihannya sendiri, tidak pernah melebarkannya.
    const vendorId = scope ?? q.vendorId;
    const where = and(
      q.status ? eq(picklistHeaders.status, q.status) : undefined,
      vendorId ? eq(picklistHeaders.vendorId, vendorId) : undefined,
      plantId ? eq(picklistHeaders.plantId, plantId) : undefined,
    );
    const [rows, totalRows] = await Promise.all([
      this.db
        .select({
          id: picklistHeaders.id,
          publicId: picklistHeaders.publicId,
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

  async resolveId(reference: string, scope: VendorScope, plantId?: number): Promise<number> {
    const legacyId = /^\d+$/.test(reference) ? Number(reference) : null;
    const [row] = await this.db.select({ id: picklistHeaders.id }).from(picklistHeaders).where(and(
      legacyId && Number.isSafeInteger(legacyId)
        ? or(eq(picklistHeaders.publicId, reference), eq(picklistHeaders.id, legacyId))
        : eq(picklistHeaders.publicId, reference),
      scope ? eq(picklistHeaders.vendorId, scope) : undefined,
      plantId ? eq(picklistHeaders.plantId, plantId) : undefined,
    )).limit(1);
    if (!row) throw new NotFoundException('Order Sheet tidak ditemukan');
    return row.id;
  }

  async get(id: number, scope: VendorScope, plantId?: number) {
    const [header] = await this.db
        .select({
          id: picklistHeaders.id,
          publicId: picklistHeaders.publicId,
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
        and(
          eq(picklistHeaders.id, id),
          scope ? eq(picklistHeaders.vendorId, scope) : undefined,
          plantId ? eq(picklistHeaders.plantId, plantId) : undefined,
        ),
      );
    if (!header) throw new NotFoundException('Order Sheet tidak ditemukan');

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
   * Header dikunci agar unduhan PDF dan kanban bersamaan hanya mencatat
   * satu timestamp dan satu audit DOWNLOAD dalam transaksi yang sama.
   *
   * Status asal diambil dari tabel transisi di domain, bukan ditulis ulang di
   * sini (aturan repo 3).
   */
  async markDownloaded(id: number, vendorId: number, plantId?: number, userId?: number): Promise<void> {
    const dariMana = (
      Object.keys(PICKLIST_TRANSITIONS) as Array<keyof typeof PICKLIST_TRANSITIONS>
    ).filter((dari) => PICKLIST_TRANSITIONS[dari].includes('DOWNLOADED'));
    if (dariMana.length === 0) return;

    await this.db.transaction(async (tx) => {
      const [pl] = await tx.select().from(picklistHeaders).where(and(
        eq(picklistHeaders.id, id), eq(picklistHeaders.vendorId, vendorId),
        plantId ? eq(picklistHeaders.plantId, plantId) : undefined,
        inArray(picklistHeaders.status, dariMana),
      )).for('update');
      if (!pl) return;
      const downloadedAt = new Date();
      await tx.update(picklistHeaders).set({ status: 'DOWNLOADED', downloadedAt })
        .where(eq(picklistHeaders.id, id));
      if (userId) await writeAudit(tx, 'TT_PICKLIST_H', id, 'DOWNLOAD', userId,
        { status: pl.status }, { status: 'DOWNLOADED', downloadedAt });
    });
  }

  /**
   * Jadwal cutoff supplier untuk order manual. Cutoff tanpa jam berarti satu
   * jadwal per supplier, jadi cycle selalu 1 (kedatangan pertama hari itu).
   */
  private async resolveCutoff(tx: Transaction, vendorId: number, cutoffId?: number) {
    const [dipilih] = await tx
      .select({ id: vendorCutoffs.id, arrivalTime: vendorCutoffs.arrivalTime })
      .from(vendorCutoffs)
      .where(and(
        eq(vendorCutoffs.vendorId, vendorId),
        eq(vendorCutoffs.isActive, true),
        cutoffId ? eq(vendorCutoffs.id, cutoffId) : undefined,
      ))
      .limit(1);
    if (!dipilih) {
      throw new BadRequestException(
        cutoffId
          ? 'Cutoff tidak ditemukan untuk supplier ini'
          : 'Supplier belum punya setting cutoff aktif (F-04)',
      );
    }
    return { ...dipilih, cycle: 1 };
  }
}

/** Tanggal kalender YYYY-MM-DD + n hari, tanpa geser zona waktu. */
/** Tanggal hari ini di zona pabrik (Asia/Jakarta), bukan zona server. */
function hariIni(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(now);
}

function tambahHari(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Kolom Order Sheet asal yang dibutuhkan saat menerbitkan recovery-nya. */
interface RecoverySource {
  id: number;
  plantId: number;
  picklistNo: string;
  revision: number;
  type: PicklistType;
  vendorId: number;
  cutoffAt: Date;
  deliveryDate: string;
  arrivalTime: string;
  cycle: number;
  createdById: number | null;
}
