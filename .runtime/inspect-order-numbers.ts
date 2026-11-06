import { getDb, closeDb } from '../packages/db/src/client';
import { picklistHeaders, plants, receiptHeaders, sapOutbox, sequences } from '../packages/db/src/schema';
import { eq } from '../packages/db/node_modules/drizzle-orm';

async function main() {
  const db = getDb();
  const orders = await db.select({
    id: picklistHeaders.id, publicId: picklistHeaders.publicId, no: picklistHeaders.picklistNo,
    revision: picklistHeaders.revision, plantId: picklistHeaders.plantId,
    plant: plants.code, delivery: picklistHeaders.deliveryDate, status: picklistHeaders.status,
    note: picklistHeaders.note, pdfReadyAt: picklistHeaders.pdfReadyAt,
  }).from(picklistHeaders).innerJoin(plants, eq(picklistHeaders.plantId, plants.id));
  console.log(JSON.stringify({ orders, sequences: await db.select().from(sequences),
    outbox: await db.select({id:sapOutbox.id,status:sapOutbox.status,sourceId:sapOutbox.sourceId,payload:sapOutbox.payload}).from(sapOutbox),
    receipts:await db.select({id:receiptHeaders.id,no:receiptHeaders.receiptNo,picklistId:receiptHeaders.picklistId}).from(receiptHeaders)
  }, null, 2));
}
main().finally(closeDb);
