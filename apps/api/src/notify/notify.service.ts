import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import nodemailer, { type Transporter } from 'nodemailer';
import {
  and,
  desc,
  emailDeliveries,
  eq,
  inArray,
  isNull,
  isNotNull,
  parts,
  picklistHeaders,
  picklistLines,
  roles,
  users,
  vendorCutoffs,
  vendorParts,
  vendors,
  sql,
  type Database,
} from '@ares/db';
import { dueReminderKinds, noticeResendBlock, orderSheetDisplayNo } from '@ares/domain';
import type { PicklistNoticeKind } from '@ares/contracts';
import { InjectDb } from '../db/db.module';
import { QueueService } from '../queue/queue.service';
import { JOBS, QUEUES } from '../queue/queue.constants';
import { writeAudit } from '../common/audit';

/** Peristiwa yang mengirim email ke supplier (PRD 8.4). */
export type { PicklistNoticeKind } from '@ares/contracts';

export interface NotificationJob {
  kind: PicklistNoticeKind;
  picklistId: number;
  deliveryId?: number;
}

/** Perubahan kemasan vendor part oleh supplier — kabar untuk PPIC. */
export interface VendorPartNoticeJob {
  vendorPartId: number;
  userId: number;
  changes: Array<{ field: string; label: string; before: string; after: string }>;
}

export interface LoginOtpEmailJob {
  email: string;
  name: string;
  code: string;
  expiresInMinutes: number;
}

/**
 * Email ke akun supplier (F-31, PRD 8.4).
 *
 * Dipanggil hanya dari worker (aturan repo 2): request cukup mengantrekan
 * job `send-notification`. Tanpa SMTP_HOST, isi email ditulis ke log — di dev
 * dan di server yang belum punya relay, alurnya tetap bisa dilihat utuh.
 */
@Injectable()
export class NotifyService {
  private readonly logger = new Logger(NotifyService.name);
  private readonly transport: Transporter | null;

  constructor(@InjectDb() private readonly db: Database, private readonly queue: QueueService) {
    const host = process.env.SMTP_HOST?.trim();
    this.transport = host
      ? (() => {
          const secure = ['true', '1', 'yes'].includes(
            (process.env.SMTP_SECURE ?? '').toLowerCase(),
          );
          return nodemailer.createTransport({
            host,
            port: Number(process.env.SMTP_PORT ?? 587),
            secure,
            requireTLS: process.env.NODE_ENV === 'production' && !secure,
            auth: process.env.SMTP_USER
              ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? '' }
              : undefined,
          });
        })()
      : null;
    if (!this.transport) this.logger.warn('SMTP_HOST kosong — email hanya ditulis ke log');
  }

  /** F-31: simpan permintaan sebelum mengantre; Redis mati tetap terlihat sebagai gagal. */
  async enqueuePicklistNotice(
    kind: PicklistNoticeKind,
    picklistId: number,
    actor?: { userId: number; plantId: number },
  ) {
    const delivery = await this.db.transaction(async (tx) => {
      const [pl] = await tx.select().from(picklistHeaders).where(and(
        eq(picklistHeaders.id, picklistId),
        actor ? eq(picklistHeaders.plantId, actor.plantId) : undefined,
      )).for('update');
      if (!pl) throw new NotFoundException('Order Sheet tidak ditemukan');
      if (actor) {
        const [latest] = await tx.select().from(emailDeliveries)
          .where(eq(emailDeliveries.picklistId, picklistId)).orderBy(desc(emailDeliveries.id)).limit(1);
        const block = noticeResendBlock(pl.status, latest);
        if (block) throw new ConflictException(block);
      } else {
        const [existing] = await tx.select().from(emailDeliveries)
          .where(eq(emailDeliveries.dedupeKey, `${picklistId}-${kind}`)).limit(1);
        if (existing) return { ...existing, existing: true };
      }
      const [id] = await tx.insert(emailDeliveries).values({
        picklistId, kind, dedupeKey: actor ? randomUUID() : `${picklistId}-${kind}`,
        requestedById: actor?.userId ?? null, recipients: [], cc: [], accepted: [],
      }).$returningId();
      if (actor) await writeAudit(tx, 'TT_PICKLIST_H', picklistId, 'RESEND_EMAIL', actor.userId,
        null, { deliveryId: id!.id, kind });
      return { id: id!.id, existing: false };
    });
    if (!delivery.existing) {
      try {
        await this.queue.add(QUEUES.NOTIFICATION, JOBS.SEND_NOTIFICATION,
          { kind, picklistId, deliveryId: delivery.id }, { jobId: `email-${delivery.id}` });
      } catch (error) {
        // Jangan menimpa hasil worker jika Redis sebenarnya menerima job sebelum timeout.
        await this.db.update(emailDeliveries).set({
          status: 'FAILED', lastError: 'Tidak bisa memasukkan email ke antrean. Silakan kirim ulang.',
          finishedAt: new Date(),
        }).where(and(eq(emailDeliveries.id, delivery.id), eq(emailDeliveries.status, 'QUEUED')));
        this.logger.error(`Email ${delivery.id} gagal diantre`);
      }
    }
    return { deliveryId: delivery.id };
  }

  async sendLoginOtp(job: LoginOtpEmailJob): Promise<{ recipients: number; sent: boolean }> {
    const subject = '[ARES] Kode OTP login';
    const text = [
      `Halo ${job.name},`,
      '',
      `Kode OTP login ARES Anda: ${job.code}`,
      '',
      `Kode berlaku ${job.expiresInMinutes} menit dan hanya dapat dipakai satu kali.`,
      'Abaikan email ini jika Anda tidak sedang mencoba masuk.',
    ].join('\n');
    if (!this.transport) {
      if (process.env.NODE_ENV !== 'production') {
        this.logger.warn(`[DEV OTP] ${job.email}: ${job.code}`);
      }
      return { recipients: 1, sent: false };
    }
    await this.transport.sendMail({ from: process.env.SMTP_FROM, to: job.email, subject, text });
    return { recipients: 1, sent: true };
  }

  /** Isi email picklist terbit / direvisi: nomor, tanggal & jam kirim, jumlah line & box, tautan portal. */
  async sendPicklistNotice(job: NotificationJob, willRetry = false): Promise<{ recipients: number; sent: boolean }> {
    // Job lama yang masih tersimpan di Redis tetap melewati pencatatan baru.
    if (!job.deliveryId) return this.enqueuePicklistNotice(job.kind, job.picklistId)
      .then(() => ({ recipients: 0, sent: false }));
    const [delivery] = await this.db.select().from(emailDeliveries).where(and(
      eq(emailDeliveries.id, job.deliveryId), eq(emailDeliveries.picklistId, job.picklistId),
      eq(emailDeliveries.kind, job.kind),
    ));
    if (!delivery || delivery.status === 'ACCEPTED' || delivery.status === 'SKIPPED')
      return { recipients: delivery?.recipients.length ?? 0, sent: delivery?.status === 'ACCEPTED' };
    await this.db.update(emailDeliveries).set({
      status: 'PROCESSING', attempts: sql`${emailDeliveries.attempts} + 1`,
      attemptedAt: new Date(), finishedAt: null, lastError: null,
    }).where(eq(emailDeliveries.id, delivery.id));
    try {
      return await this.deliverPicklistNotice(job, delivery);
    } catch (error) {
      // Respons mentah SMTP dapat berisi alamat/konfigurasi relay; jangan kirim ke UI.
      await this.db.update(emailDeliveries).set({
        status: willRetry ? 'QUEUED' : 'FAILED',
        lastError: 'Email gagal terkirim, coba kirim ulang.',
        finishedAt: willRetry ? null : new Date(),
      }).where(eq(emailDeliveries.id, delivery.id));
      throw error;
    }
  }

  private async deliverPicklistNotice(job: NotificationJob, delivery: typeof emailDeliveries.$inferSelect) {
    const [pl] = await this.db
      .select({
        id: picklistHeaders.id,
        publicId: picklistHeaders.publicId,
        plantId: picklistHeaders.plantId,
        status: picklistHeaders.status,
        picklistNo: picklistHeaders.picklistNo,
        revision: picklistHeaders.revision,
        deliveryDate: picklistHeaders.deliveryDate,
        arrivalTime: picklistHeaders.arrivalTime,
        vendorId: picklistHeaders.vendorId,
        vendorName: vendors.name,
        lineCount: sql<number>`(select count(*) from ${picklistLines} where ${picklistLines.picklistId} = ${picklistHeaders.id})`,
        boxOrdered: sql<number>`(select coalesce(sum(${picklistLines.boxOrdered}), 0) from ${picklistLines} where ${picklistLines.picklistId} = ${picklistHeaders.id})`,
      })
      .from(picklistHeaders)
      .innerJoin(vendors, eq(picklistHeaders.vendorId, vendors.id))
      .where(eq(picklistHeaders.id, job.picklistId));
    if (!pl) throw new NotFoundException('Order Sheet tidak ditemukan');
    if (pl.status === 'CANCELLED') {
      await this.db.update(emailDeliveries).set({ status: 'SKIPPED',
        lastError: 'Order sudah dibatalkan sebelum email dikirim.', finishedAt: new Date(),
      }).where(eq(emailDeliveries.id, delivery.id));
      return { recipients: 0, sent: false };
    }

    // Semua akun vendor itu yang punya email dan masih aktif (8.4).
    const penerima = await this.db
      .select({ email: users.email, name: users.name })
      .from(users)
      .where(
        and(eq(users.vendorId, pl.vendorId), eq(users.isActive, true), isNotNull(users.email)),
      );
    const to = [...new Set(penerima.map((p) => p.email!.trim().toLowerCase()).filter(Boolean))];

    const nomor = orderSheetDisplayNo(pl.picklistNo, pl.revision);
    const subject =
      job.kind === 'PICKLIST_REVISED'
        ? `[ARES] Revisi Order Sheet ${nomor} — kirim ${pl.deliveryDate}`
        : job.kind === 'REMINDER_NOT_DOWNLOADED'
          ? `[ARES] Pengingat unduh Order Sheet ${nomor}`
          : job.kind === 'REMINDER_NOT_CONFIRMED'
            ? `[ARES] Pengingat konfirmasi Order Sheet ${nomor}`
            : `[ARES] Order Sheet baru ${nomor} — kirim ${pl.deliveryDate}`;
    const portal = `${(process.env.WEB_ORIGIN ?? 'http://127.0.0.1:3000').split(',')[0]!.trim()}/portal/${pl.publicId}`;
    const text = [
      `Yth. ${pl.vendorName},`,
      '',
      job.kind === 'PICKLIST_REVISED'
        ? `Order Sheet ${nomor} direvisi: baris berikut adalah sisa yang belum terkirim.`
        : job.kind === 'REMINDER_NOT_DOWNLOADED'
          ? `Order Sheet ${nomor} belum diunduh. Mohon unduh dokumen Order Sheet dan kanban.`
          : job.kind === 'REMINDER_NOT_CONFIRMED'
            ? `Pengiriman Order Sheet ${nomor} belum dikonfirmasi. Mohon perbarui jumlah box dan ETA.`
            : `Order Sheet ${nomor} sudah terbit.`,
      `Tanggal kirim : ${pl.deliveryDate} jam ${String(pl.arrivalTime).slice(0, 5)}`,
      `Isi           : ${Number(pl.lineCount)} part, ${Number(pl.boxOrdered)} box`,
      '',
      `Unduh Order Sheet dan kanban, lalu konfirmasi kirim di portal: ${portal}`,
      '',
      'Email ini dikirim otomatis oleh ARES e-Kanban.',
    ].join('\n');

    if (to.length === 0) {
      this.logger.warn(`notifikasi ${nomor}: vendor ${pl.vendorName} belum punya akun ber-email`);
      await this.db.update(emailDeliveries).set({ status: 'FAILED', recipients: [], cc: [],
        lastError: 'Supplier belum memiliki akun aktif dengan email.', finishedAt: new Date(),
      }).where(eq(emailDeliveries.id, delivery.id));
      return { recipients: 0, sent: false };
    }
    const reminder = job.kind.startsWith('REMINDER_');
    const cc = reminder
      ? (
          await this.db
            .select({ email: users.email })
            .from(users)
            .innerJoin(roles, eq(users.roleId, roles.id))
            .where(and(eq(roles.name, 'ppic'), eq(users.plantId, pl.plantId),
              eq(users.isActive, true), isNotNull(users.email)))
        )
          .map((row) => row.email!)
          .filter(Boolean)
      : [];
    // Snapshot penerima dijaga saat retry; alamat yang sudah diterima SMTP tidak dikirimi dua kali.
    const recipients = delivery.recipients.length ? delivery.recipients : to;
    const copy = delivery.recipients.length ? delivery.cc : [...new Set(cc.map((email) => email.toLowerCase()))];
    await this.db.update(emailDeliveries).set({ recipients, cc: copy })
      .where(eq(emailDeliveries.id, delivery.id));
    if (!this.transport) {
      if (process.env.NODE_ENV === 'production') {
        this.logger.warn(`email ${nomor} tidak dikirim karena SMTP belum dikonfigurasi`);
      } else {
        this.logger.log(
          `[email log] to=${to.join(', ')}${cc.length ? ` cc=${cc.join(', ')}` : ''} ` +
            `subject="${subject}"\n${text}`,
        );
      }
      await this.db.update(emailDeliveries).set({ status: 'SKIPPED', finishedAt: new Date(),
        lastError: 'Pengiriman email belum aktif.',
      }).where(eq(emailDeliveries.id, delivery.id));
      return { recipients: to.length, sent: false };
    }
    const pending = (emails: string[]) => emails.filter((email) => !delivery.accepted.includes(email));
    const remainingTo = pending(recipients);
    const remainingCc = pending(copy);
    if (remainingTo.length || remainingCc.length) {
      const info = await this.transport.sendMail({ from: process.env.SMTP_FROM,
        to: remainingTo, cc: remainingCc, subject, text,
        messageId: delivery.messageId ?? `<ares-email-${delivery.id}@ares.local>`,
      });
      const accepted = [...new Set([...delivery.accepted,
        ...(info.accepted ?? []).map((address: string | { address: string }) =>
          (typeof address === 'string' ? address : address.address).toLowerCase()),
      ])];
      await this.db.update(emailDeliveries).set({ accepted,
        messageId: String(info.messageId ?? '').slice(0, 255),
      }).where(eq(emailDeliveries.id, delivery.id));
      if ([...recipients, ...copy].some((email) => !accepted.includes(email)))
        throw new Error('Sebagian penerima gagal dikirimi email');
    }
    await this.db.update(emailDeliveries).set({ status: 'ACCEPTED', finishedAt: new Date(), lastError: null })
      .where(eq(emailDeliveries.id, delivery.id));
    this.logger.log(`email ${nomor} terkirim ke ${to.length} akun ${pl.vendorName}`);
    return { recipients: to.length, sent: true };
  }

  /**
   * Supplier mengubah kemasan vendor part-nya (back number, rak, tipe box).
   *
   * Perubahannya langsung berlaku — yang dikirim di sini hanya kabar, supaya
   * PPIC tidak kaget saat kanban tercetak berbeda. Penerimanya semua akun PPIC
   * aktif yang punya email; jejak lengkapnya tetap di TT_AUDIT_LOG (F-54).
   */
  async sendVendorPartNotice(
    job: VendorPartNoticeJob,
  ): Promise<{ recipients: number; sent: boolean }> {
    const [row] = await this.db
      .select({
        id: vendorParts.id,
        partNo: parts.partNo,
        partName: parts.name,
        vendorName: vendors.name,
        sapVendorNo: vendors.sapVendorNo,
      })
      .from(vendorParts)
      .innerJoin(parts, eq(vendorParts.partId, parts.id))
      .innerJoin(vendors, eq(vendorParts.vendorId, vendors.id))
      .where(eq(vendorParts.id, job.vendorPartId));
    if (!row) {
      this.logger.warn(`notifikasi vendor part ${job.vendorPartId} tidak ada`);
      return { recipients: 0, sent: false };
    }

    const [pengubah] = await this.db
      .select({ name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, job.userId));

    const ppic = await this.db
      .select({ email: users.email })
      .from(users)
      .innerJoin(roles, eq(users.roleId, roles.id))
      .where(and(eq(roles.name, 'ppic'), eq(users.isActive, true), isNotNull(users.email)));
    const to = ppic.map((r) => r.email!).filter(Boolean);

    const subject = `[ARES] ${row.vendorName} mengubah kemasan ${row.partNo}`;
    const master = `${process.env.WEB_ORIGIN ?? 'http://127.0.0.1:3000'}/master/vendorParts?q=${encodeURIComponent(row.partNo)}`;
    const text = [
      `Supplier ${row.vendorName} (${row.sapVendorNo}) memperbarui kemasan vendor part.`,
      '',
      `Part    : ${row.partNo} — ${row.partName}`,
      `Diubah  : ${pengubah?.name ?? 'akun supplier'}${pengubah?.email ? ` (${pengubah.email})` : ''}`,
      '',
      ...job.changes.map((c) => `${c.label}: ${c.before || '(kosong)'} → ${c.after || '(kosong)'}`),
      '',
      'Perubahan ini sudah berlaku dan akan ikut tercetak pada kanban berikutnya.',
      `Periksa di master vendor part: ${master}`,
      '',
      'Email ini dikirim otomatis oleh ARES e-Kanban.',
    ].join('\n');

    if (to.length === 0) {
      this.logger.warn('perubahan kemasan vendor part: belum ada akun PPIC ber-email');
      return { recipients: 0, sent: false };
    }
    if (!this.transport) {
      if (process.env.NODE_ENV === 'production') {
        this.logger.warn('kabar perubahan kemasan tidak dikirim karena SMTP belum dikonfigurasi');
      } else {
        this.logger.log(`[email log] to=${to.join(', ')} subject="${subject}"\n${text}`);
      }
      return { recipients: to.length, sent: false };
    }
    await this.transport.sendMail({ from: process.env.SMTP_FROM, to, subject, text });
    this.logger.log(`kabar kemasan ${row.partNo} terkirim ke ${to.length} akun PPIC`);
    return { recipients: to.length, sent: true };
  }

  /** F-08: klaim dan kirim pengingat yang jatuh tempo, satu kali per picklist dan jenis. */
  async sendDueReminders(now = new Date()): Promise<{ processed: number }> {
    const [picklists, settings] = await Promise.all([
      this.db
        .select({
          id: picklistHeaders.id,
          status: picklistHeaders.status,
          vendorId: picklistHeaders.vendorId,
          deliveryDate: picklistHeaders.deliveryDate,
          arrivalTime: picklistHeaders.arrivalTime,
          createdAt: picklistHeaders.createdAt,
          downloadedAt: picklistHeaders.downloadedAt,
          shippedAt: picklistHeaders.shippedAt,
          downloadReminderAt: picklistHeaders.downloadReminderAt,
          confirmReminderAt: picklistHeaders.confirmReminderAt,
        })
        .from(picklistHeaders)
        .where(inArray(picklistHeaders.status, ['ISSUED', 'DOWNLOADED'])),
      this.db
        .select({
          vendorId: vendorCutoffs.vendorId,
          arrivalTime: vendorCutoffs.arrivalTime,
          downloadWarningHours: vendorCutoffs.downloadWarningHours,
          confirmWarningHours: vendorCutoffs.confirmWarningHours,
        })
        .from(vendorCutoffs)
        .where(eq(vendorCutoffs.isActive, true)),
    ]);

    let processed = 0;
    for (const pl of picklists) {
      const setting =
        settings.find(
          (row) =>
            row.vendorId === pl.vendorId &&
            String(row.arrivalTime).slice(0, 5) === String(pl.arrivalTime).slice(0, 5),
        ) ?? settings.find((row) => row.vendorId === pl.vendorId);
      const arrivalAt = new Date(`${pl.deliveryDate}T${String(pl.arrivalTime).slice(0, 8)}+07:00`);
      const due = dueReminderKinds(
        {
          ...pl,
          arrivalAt,
          downloadWarningHours: setting?.downloadWarningHours ?? 2,
          confirmWarningHours: setting?.confirmWarningHours ?? 3,
        },
        now,
      );

      for (const kind of due) {
        const column =
          kind === 'NOT_DOWNLOADED'
            ? picklistHeaders.downloadReminderAt
            : picklistHeaders.confirmReminderAt;
        const result = await this.db
          .update(picklistHeaders)
          .set(kind === 'NOT_DOWNLOADED' ? { downloadReminderAt: now } : { confirmReminderAt: now })
          .where(and(eq(picklistHeaders.id, pl.id), isNull(column)));
        const claimed = Number(
          (result as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0,
        );
        if (!claimed) continue;
        try {
          await this.enqueuePicklistNotice(
            kind === 'NOT_DOWNLOADED' ? 'REMINDER_NOT_DOWNLOADED' : 'REMINDER_NOT_CONFIRMED', pl.id,
          );
          processed += 1;
        } catch (error) {
          await this.db
            .update(picklistHeaders)
            .set(
              kind === 'NOT_DOWNLOADED'
                ? { downloadReminderAt: null }
                : { confirmReminderAt: null },
            )
            .where(eq(picklistHeaders.id, pl.id));
          throw error;
        }
      }
    }
    return { processed };
  }
}
