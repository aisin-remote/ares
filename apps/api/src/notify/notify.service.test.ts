import 'reflect-metadata';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import nodemailer from 'nodemailer';
import { and, auditLogs, closeDb, emailDeliveries, eq, getDb, inArray,
  picklistHeaders, plants, roles, users, vendors } from '@ares/db';
import { NotifyService, type NotificationJob } from './notify.service';
import type { QueueService } from '../queue/queue.service';

const db = getDb();
const stamp = Date.now().toString().slice(-10);
const jobs: NotificationJob[] = [];
const queue = { add: vi.fn(async (_queue: string, _name: string, payload: NotificationJob) => { jobs.push(payload); return 'test'; }) } as unknown as QueueService;
let vendorId: number;
let plantId: number;
let actorId: number;
let orderId: number;
const supplierEmails = [`notice-a-${stamp}@example.test`, `notice-b-${stamp}@example.test`];
const originalHost = process.env.SMTP_HOST;

async function newOrder() {
  orderId = (await db.insert(picklistHeaders).values({
    picklistNo: `EMAIL-${stamp}-${Math.random().toString(36).slice(2, 6)}`,
    plantId, vendorId, type: 'MANUAL', cutoffAt: new Date(), deliveryDate: '2026-10-22',
    arrivalTime: '14:00:00', createdById: actorId,
  }).$returningId())[0]!.id;
  jobs.length = 0;
  vi.mocked(queue.add).mockClear();
  return orderId;
}

beforeAll(async () => {
  const [plant] = await db.select().from(plants).limit(1);
  const [actor] = await db.select().from(users).limit(1);
  const [role] = await db.select().from(roles).where(eq(roles.name, 'supplier'));
  plantId = plant!.id; actorId = actor!.id;
  vendorId = (await db.insert(vendors).values({ plantId, sapVendorNo: `NE${stamp}`, name: 'Supplier uji email' }).$returningId())[0]!.id;
  await db.insert(users).values(supplierEmails.map((email, index) => ({
    npk: `NE${stamp}-${index}`, name: 'Supplier uji notifikasi', email, vendorId, plantId, roleId: role!.id, isActive: true,
  })));
});

afterEach(() => { vi.restoreAllMocks(); if (originalHost === undefined) delete process.env.SMTP_HOST; else process.env.SMTP_HOST = originalHost; });
afterAll(async () => {
  const orders = await db.select({ id: picklistHeaders.id }).from(picklistHeaders).where(eq(picklistHeaders.vendorId, vendorId));
  if (orders.length) {
    await db.delete(auditLogs).where(and(eq(auditLogs.entity, 'TT_PICKLIST_H'), inArray(auditLogs.entityId, orders.map((row) => String(row.id)))));
    await db.delete(picklistHeaders).where(inArray(picklistHeaders.id, orders.map((row) => row.id)));
  }
  await db.delete(users).where(eq(users.vendorId, vendorId));
  await db.delete(vendors).where(eq(vendors.id, vendorId));
  await closeDb();
});

describe('pencatatan email order', () => {
  it('menyimpan antrean idempoten, dan tanpa SMTP tidak mengklaim terkirim', async () => {
    delete process.env.SMTP_HOST;
    const service = new NotifyService(db, queue);
    await newOrder();
    const first = await service.enqueuePicklistNotice('PICKLIST_ISSUED', orderId);
    const second = await service.enqueuePicklistNotice('PICKLIST_ISSUED', orderId);
    expect(first).toEqual(second);
    expect(jobs).toHaveLength(1);
    const [queued] = await db.select().from(emailDeliveries).where(eq(emailDeliveries.id, first.deliveryId));
    expect(queued?.status).toBe('QUEUED');
    await service.sendPicklistNotice(jobs[0]!);
    const [record] = await db.select().from(emailDeliveries).where(eq(emailDeliveries.id, first.deliveryId));
    expect(record).toMatchObject({ status: 'SKIPPED', attempts: 1, accepted: [] });
    expect(record!.recipients.sort()).toEqual(supplierEmails.slice().sort());
    expect(record!.lastError).toContain('SMTP belum');
  });

  it('menyimpan kegagalan antrean Redis agar bisa ditangani PPIC', async () => {
    const service = new NotifyService(db, queue);
    await newOrder();
    vi.mocked(queue.add).mockRejectedValueOnce(new Error('Redis mati'));
    const result = await service.enqueuePicklistNotice('PICKLIST_ISSUED', orderId);
    const [record] = await db.select().from(emailDeliveries).where(eq(emailDeliveries.id, result.deliveryId));
    expect(record).toMatchObject({ status: 'FAILED', attempts: 0 });
  });

  it('mencatat retry SMTP dan tidak mengirim ulang ke penerima yang sudah diterima', async () => {
    process.env.SMTP_HOST = 'mock.example.test';
    const sendMail = vi.fn()
      .mockResolvedValueOnce({ accepted: [supplierEmails[0]], rejected: [supplierEmails[1]], messageId: 'test-id' })
      .mockResolvedValueOnce({ accepted: [supplierEmails[1]], rejected: [], messageId: 'test-id' });
    vi.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail } as never);
    const service = new NotifyService(db, queue);
    await newOrder();
    const result = await service.enqueuePicklistNotice('PICKLIST_ISSUED', orderId);
    await expect(service.sendPicklistNotice(jobs[0]!, true)).rejects.toThrow();
    let [record] = await db.select().from(emailDeliveries).where(eq(emailDeliveries.id, result.deliveryId));
    expect(record).toMatchObject({ status: 'QUEUED', attempts: 1, accepted: [supplierEmails[0]] });
    await service.sendPicklistNotice(jobs[0]!);
    [record] = await db.select().from(emailDeliveries).where(eq(emailDeliveries.id, result.deliveryId));
    expect(record).toMatchObject({ status: 'ACCEPTED', attempts: 2, lastError: null });
    expect(sendMail.mock.calls[1]![0].to).toEqual([supplierEmails[1]]);
    const [order] = await db.select().from(picklistHeaders).where(eq(picklistHeaders.id, orderId));
    expect(sendMail.mock.calls[0]![0].text).toContain(`/portal/${order!.publicId}`);
    await service.sendPicklistNotice(jobs[0]!);
    expect(sendMail).toHaveBeenCalledTimes(2);
  });

  it('membedakan gagal final dari antre retry dan menyembunyikan respons SMTP mentah', async () => {
    process.env.SMTP_HOST = 'mock.example.test';
    vi.spyOn(nodemailer, 'createTransport').mockReturnValue({
      sendMail: vi.fn().mockRejectedValue(Object.assign(new Error('secret relay response'), { code: 'ECONNECTION' })),
    } as never);
    const service = new NotifyService(db, queue);
    await newOrder();
    const result = await service.enqueuePicklistNotice('PICKLIST_ISSUED', orderId);
    await expect(service.sendPicklistNotice(jobs[0]!)).rejects.toThrow();
    const [record] = await db.select().from(emailDeliveries).where(eq(emailDeliveries.id, result.deliveryId));
    expect(record?.status).toBe('FAILED');
    expect(record?.lastError).toContain('ECONNECTION');
    expect(record?.lastError).not.toContain('secret');
  });

  it('kirim ulang memeriksa pabrik, batal, cooldown, dan mengunci permintaan bersamaan', async () => {
    delete process.env.SMTP_HOST;
    const service = new NotifyService(db, queue);
    await newOrder();
    const actor = { userId: actorId, plantId };
    await expect(service.enqueuePicklistNotice('PICKLIST_ISSUED', orderId, { ...actor, plantId: 999999 })).rejects.toThrow('tidak ditemukan');
    await service.enqueuePicklistNotice('PICKLIST_ISSUED', orderId);
    await expect(service.enqueuePicklistNotice('PICKLIST_ISSUED', orderId, actor)).rejects.toThrow('masih diproses');
    await service.sendPicklistNotice(jobs[0]!);
    await expect(service.enqueuePicklistNotice('PICKLIST_ISSUED', orderId, actor)).rejects.toThrow('satu menit');
    await db.update(emailDeliveries).set({ createdAt: new Date(Date.now() - 61_000) }).where(eq(emailDeliveries.picklistId, orderId));
    const results = await Promise.allSettled([
      service.enqueuePicklistNotice('PICKLIST_ISSUED', orderId, actor),
      service.enqueuePicklistNotice('PICKLIST_ISSUED', orderId, actor),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const [audit] = await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, String(orderId)), eq(auditLogs.action, 'RESEND_EMAIL')));
    expect(audit?.userId).toBe(actorId);
    await db.update(picklistHeaders).set({ status: 'CANCELLED' }).where(eq(picklistHeaders.id, orderId));
    await expect(service.enqueuePicklistNotice('PICKLIST_ISSUED', orderId, actor)).rejects.toThrow('dibatalkan');
  });
});
