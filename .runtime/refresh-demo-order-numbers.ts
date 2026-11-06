import { strict as assert } from 'node:assert';
import { writeFile } from 'node:fs/promises';
import { getDb, closeDb } from '../packages/db/src/client';
import {
  picklistHeaders, picklistLines, plants, kanbans, kanbanEvents, receiptHeaders,
  sapOutbox, sequences,
} from '../packages/db/src/schema';
import { and, asc, eq, inArray, or, sql } from '../packages/db/node_modules/drizzle-orm';
import { orderPlantInitial, orderSheetDisplayNo } from '../apps/api/node_modules/@ares/domain';
import { SequenceService } from '../apps/api/src/common/sequence.service';
import { Queue } from '../apps/api/node_modules/bullmq';
import Redis from '../apps/api/node_modules/ioredis';

async function main() {
  const databaseUrl = new URL(process.env.DATABASE_URL!);
  assert(['localhost', '127.0.0.1', '::1'].includes(databaseUrl.hostname), 'Hanya database demo lokal');
  assert(process.env.NODE_ENV !== 'production', 'Tidak dijalankan pada produksi');
  const db = getDb();
  const orders = await db.select().from(picklistHeaders).orderBy(asc(picklistHeaders.id));
  const legacy = orders.filter((row) => /^PL-[0-9]{6}-[0-9]+$/.test(row.picklistNo));
  console.log(JSON.stringify({ legacyCount: legacy.length, ids: legacy.map((row) => row.id) }));
  if (!process.argv.includes('--apply')) return;
  if (!legacy.length) return;
  const plantRows = await db.select().from(plants);
  const groups = new Map<string, typeof legacy>();
  for (const row of legacy) {
    const key = row.picklistNo;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  const receipts = await db.select().from(receiptHeaders);
  const outbox = await db.select().from(sapOutbox);
  const lines = await db.select().from(picklistLines);
  const cards = await db.select().from(kanbans);
  const events = await db.select().from(kanbanEvents);
  await writeFile(new URL('./order-number-backup.json', import.meta.url),
    JSON.stringify({ orders, receipts, outbox, lines, cards, events,
      sequences: await db.select().from(sequences) }, null, 2), { flag: 'wx' });

  const changes = await db.transaction(async (tx) => {
    // Pertahankan penghitung yang sudah terpakai sebelum mengambil nomor baru.
    for (const row of orders) {
      if (!/^[789][0-9]{11}$/.test(row.picklistNo)) continue;
      const code = 'OS' + row.picklistNo[0];
      const dateKey = row.picklistNo.slice(1, 7);
      const lastNo = Number(row.picklistNo.slice(7, 10));
      await tx.insert(sequences).values({ code, dateKey, lastNo }).onDuplicateKeyUpdate({
        set: { lastNo: sql`greatest(${sequences.lastNo}, ${lastNo})` },
      });
    }
    const sequence = new SequenceService();
    const result: Array<{ id: number; oldBase: string; base: string; revision: number; display: string }> = [];
    for (const group of groups.values()) {
      const root = group.find((row) => row.revision === 0);
      assert(root, 'Recovery harus memiliki order asal');
      assert(group.every((row) => row.plantId === root.plantId), 'Pabrik recovery tidak cocok');
      const plant = plantRows.find((item) => item.id === root.plantId);
      assert(plant, 'Pabrik order tidak ditemukan');
      const base = await sequence.nextOrder(tx, plant.code, root.deliveryDate);
      assert.equal(base[0], orderPlantInitial(plant.code));
      assert.equal(base.slice(1, 7), root.deliveryDate.slice(2).replaceAll('-', ''));
      for (const row of group) {
        const display = orderSheetDisplayNo(base, row.revision);
        await tx.update(picklistHeaders).set({ picklistNo: base, pdfReadyAt: null })
          .where(and(eq(picklistHeaders.id, row.id), eq(picklistHeaders.picklistNo, row.picklistNo)));
        await tx.update(kanbanEvents).set({ ref: base + '-' + row.revision }).where(or(
          eq(kanbanEvents.ref, row.picklistNo + '-' + row.revision),
          eq(kanbanEvents.ref, orderSheetDisplayNo(row.picklistNo, row.revision)),
        ));
        for (const receipt of receipts.filter((item) => item.picklistId === row.id)) {
          for (const item of outbox.filter((item) =>
            item.sourceTable === 'TT_RECEIPT_H' && item.sourceId === receipt.id)) {
            const payload = item.payload as Record<string, unknown>;
            await tx.update(sapOutbox).set({ payload: {
              ...payload, deliveryNote: display,
              ...(payload.plant === 'PLANT1' ? { plant: plant.code } : {}),
            } }).where(eq(sapOutbox.id, item.id));
          }
        }
        result.push({ id: row.id, oldBase: row.picklistNo, base, revision: row.revision, display });
      }
    }
    for (const row of orders) {
      if (!row.note) continue;
      let note = row.note;
      for (const change of result.filter((item) => item.revision === 0)) {
        note = note.replaceAll(change.oldBase + '-0', change.base).replaceAll(change.oldBase, change.base);
      }
      if (note !== row.note) await tx.update(picklistHeaders).set({ note }).where(eq(picklistHeaders.id, row.id));
    }
    return result;
  });
  const after = await db.select().from(picklistHeaders);
  assert.equal(after.length, orders.length);
  assert.equal(after.filter((row) => row.picklistNo.startsWith('PL-')).length, 0);
  for (const row of after) {
    const before = orders.find((item) => item.id === row.id)!;
    assert.equal(row.status, before.status);
    assert.equal(row.publicId, before.publicId);
    assert.equal(row.deliveryDate, before.deliveryDate);
  }
  assert.deepEqual(await db.select().from(receiptHeaders), receipts);
  assert.deepEqual(await db.select().from(picklistLines), lines);
  assert.deepEqual(await db.select().from(kanbans), cards);
  console.log(JSON.stringify({ converted: changes.length, changes }, null, 2));
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', { maxRetriesPerRequest: null });
  const queue = new Queue('document', { connection: redis });
  try {
    for (const change of changes) {
      await queue.add('render-pdf', { picklistId: change.id }, {
        attempts: 3, backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { age: 3600 }, removeOnFail: { age: 86400 },
      });
    }
    console.log('Render ulang dokumen diantrekan: ' + changes.length);
  } finally {
    await queue.close();
    await redis.quit();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(closeDb);
