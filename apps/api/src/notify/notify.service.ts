import { Injectable, Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import {
  and,
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
import { dueReminderKinds, orderSheetDisplayNo } from '@ares/domain';
import { InjectDb } from '../db/db.module';

/** Peristiwa yang mengirim email ke supplier (PRD 8.4). */
export type PicklistNoticeKind =
  | 'PICKLIST_ISSUED'
  | 'PICKLIST_REVISED'
  | 'REMINDER_NOT_DOWNLOADED'
  | 'REMINDER_NOT_CONFIRMED';

export interface NotificationJob {
  kind: PicklistNoticeKind;
  picklistId: number;
}

/** Perubahan kemasan vendor part oleh supplier — kabar untuk PPIC. */
export interface VendorPartNoticeJob {
  vendorPartId: number;
  userId: number;
  changes: Array<{ field: string; label: string; before: string; after: string }>;
}

export interface SupplierRegistrationNoticeJob {
  kind: 'SUPPLIER_REGISTRATION_PENDING';
  email: string;
  name: string;
  vendorName: string;
  vendorCode: string;
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

  async sendSupplierRegistrationNotice(
    job: SupplierRegistrationNoticeJob,
  ): Promise<{ recipients: number; sent: boolean }> {
    const ppic = await this.db
      .select({ email: users.email })
      .from(users)
      .innerJoin(roles, eq(users.roleId, roles.id))
      .where(and(inArray(roles.name, ['ppic', 'admin']), eq(users.isActive, true), isNotNull(users.email)));
    const to = ppic.map((row) => row.email!).filter(Boolean);
    if (to.length === 0) return { recipients: 0, sent: false };

    const link = `${process.env.WEB_ORIGIN ?? 'http://127.0.0.1:3000'}/master/users?q=${encodeURIComponent(job.email)}`;
    const subject = `[ARES] Pendaftaran supplier ${job.vendorName} perlu ditinjau`;
    const text = [
      'Ada pendaftaran supplier yang emailnya belum cocok dengan email perusahaan di master.',
      '',
      `Supplier : ${job.vendorName} (${job.vendorCode})`,
      `Nama     : ${job.name}`,
      `Email    : ${job.email}`,
      '',
      `Tinjau dan aktifkan akun melalui Master User: ${link}`,
    ].join('\n');
    if (!this.transport) {
      this.logger.warn(`pemberitahuan pendaftaran ${job.email} tidak dikirim karena SMTP belum dikonfigurasi`);
      return { recipients: to.length, sent: false };
    }
    await this.transport.sendMail({ from: process.env.SMTP_FROM, to, subject, text });
    return { recipients: to.length, sent: true };
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
      this.logger.warn(`notifikasi ${job.kind}: Order Sheet ${job.picklistId} tidak ada`);
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

    const nomor = orderSheetDisplayNo(pl.picklistNo, pl.revision);
    const subject =
      job.kind === 'PICKLIST_REVISED'
        ? `[ARES] Revisi Order Sheet ${nomor} — kirim ${pl.deliveryDate}`
        : job.kind === 'REMINDER_NOT_DOWNLOADED'
          ? `[ARES] Pengingat unduh Order Sheet ${nomor}`
          : job.kind === 'REMINDER_NOT_CONFIRMED'
            ? `[ARES] Pengingat konfirmasi Order Sheet ${nomor}`
            : `[ARES] Order Sheet baru ${nomor} — kirim ${pl.deliveryDate}`;
    const portal = `${process.env.WEB_ORIGIN ?? 'http://127.0.0.1:3000'}/portal/${pl.id}`;
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
      return { recipients: 0, sent: false };
    }
    const reminder = job.kind.startsWith('REMINDER_');
    const cc = reminder
      ? (
          await this.db
            .select({ email: users.email })
            .from(users)
            .innerJoin(roles, eq(users.roleId, roles.id))
            .where(and(eq(roles.name, 'ppic'), eq(users.isActive, true), isNotNull(users.email)))
        )
          .map((row) => row.email!)
          .filter(Boolean)
      : [];
    if (!this.transport) {
      if (process.env.NODE_ENV === 'production') {
        this.logger.warn(`email ${nomor} tidak dikirim karena SMTP belum dikonfigurasi`);
      } else {
        this.logger.log(
          `[email log] to=${to.join(', ')}${cc.length ? ` cc=${cc.join(', ')}` : ''} ` +
            `subject="${subject}"\n${text}`,
        );
      }
      return { recipients: to.length, sent: false };
    }
    await this.transport.sendMail({ from: process.env.SMTP_FROM, to, cc, subject, text });
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
          await this.sendPicklistNotice({
            kind: kind === 'NOT_DOWNLOADED' ? 'REMINDER_NOT_DOWNLOADED' : 'REMINDER_NOT_CONFIRMED',
            picklistId: pl.id,
          });
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
