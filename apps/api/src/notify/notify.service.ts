import { Injectable, Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import {
  and,
  eq,
  isNotNull,
  picklistHeaders,
  picklistLines,
  users,
  vendors,
  sql,
  type Database,
} from '@ares/db';
import { InjectDb } from '../db/db.module';

/** Peristiwa yang mengirim email ke supplier (PRD 8.4). */
export type PicklistNoticeKind = 'PICKLIST_ISSUED' | 'PICKLIST_REVISED';

export interface NotificationJob {
  kind: PicklistNoticeKind;
  picklistId: number;
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

  constructor(@InjectDb() private readonly db: Database) {
    const host = process.env.SMTP_HOST?.trim();
    this.transport = host
      ? nodemailer.createTransport({
          host,
          port: Number(process.env.SMTP_PORT ?? 587),
          secure: ['true', '1', 'yes'].includes((process.env.SMTP_SECURE ?? '').toLowerCase()),
          auth: process.env.SMTP_USER
            ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? '' }
            : undefined,
        })
      : null;
    if (!this.transport) this.logger.warn('SMTP_HOST kosong — email hanya ditulis ke log');
  }

  /** Isi email picklist terbit / direvisi: nomor, tanggal & jam kirim, jumlah line & box, tautan portal. */
  async sendPicklistNotice(job: NotificationJob): Promise<{ recipients: number; sent: boolean }> {
    const [pl] = await this.db
      .select({
        id: picklistHeaders.id,
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
    if (!pl) {
      this.logger.warn(`notifikasi ${job.kind}: picklist ${job.picklistId} tidak ada`);
      return { recipients: 0, sent: false };
    }

    // Semua akun vendor itu yang punya email dan masih aktif (8.4).
    const penerima = await this.db
      .select({ email: users.email, name: users.name })
      .from(users)
      .where(
        and(eq(users.vendorId, pl.vendorId), eq(users.isActive, true), isNotNull(users.email)),
      );
    const to = penerima.map((p) => p.email!).filter(Boolean);

    const nomor = pl.revision > 0 ? `${pl.picklistNo} rev ${pl.revision}` : pl.picklistNo;
    const subject =
      job.kind === 'PICKLIST_REVISED'
        ? `[ARES] Revisi order ${nomor} — kirim ${pl.deliveryDate}`
        : `[ARES] Order baru ${nomor} — kirim ${pl.deliveryDate}`;
    const portal = `${process.env.WEB_ORIGIN ?? 'http://127.0.0.1:3000'}/portal/${pl.id}`;
    const text = [
      `Yth. ${pl.vendorName},`,
      '',
      job.kind === 'PICKLIST_REVISED'
        ? `Order ${nomor} direvisi: baris berikut adalah sisa yang belum terkirim.`
        : `Order ${nomor} sudah terbit.`,
      `Tanggal kirim : ${pl.deliveryDate} jam ${String(pl.arrivalTime).slice(0, 5)}`,
      `Isi           : ${Number(pl.lineCount)} part, ${Number(pl.boxOrdered)} box`,
      '',
      `Unduh picklist dan kanban, lalu konfirmasi kirim di portal: ${portal}`,
      '',
      'Email ini dikirim otomatis oleh ARES e-Kanban.',
    ].join('\n');

    if (to.length === 0) {
      this.logger.warn(`notifikasi ${nomor}: vendor ${pl.vendorName} belum punya akun ber-email`);
      return { recipients: 0, sent: false };
    }
    if (!this.transport) {
      this.logger.log(`[email log] to=${to.join(', ')} subject="${subject}"\n${text}`);
      return { recipients: to.length, sent: false };
    }
    await this.transport.sendMail({ from: process.env.SMTP_FROM, to, subject, text });
    this.logger.log(`email ${nomor} terkirim ke ${to.length} akun ${pl.vendorName}`);
    return { recipients: to.length, sent: true };
  }
}
