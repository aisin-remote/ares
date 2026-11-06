import { strict as assert } from 'node:assert';
import { readFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb, closeDb } from '../packages/db/src/client';
import { picklistHeaders, plants, sequences, sapOutbox } from '../packages/db/src/schema';
import { eq } from '../packages/db/node_modules/drizzle-orm';
import { orderPlantInitial, orderSheetDisplayNo } from '../apps/api/node_modules/@ares/domain';
async function main() {
  const db = getDb();
  const backup = JSON.parse(await readFile(new URL('./order-number-backup.json', import.meta.url), 'utf8'));
  const rows = await db.select({
    id:picklistHeaders.id,no:picklistHeaders.picklistNo,revision:picklistHeaders.revision,
    deliveryDate:picklistHeaders.deliveryDate,plantId:picklistHeaders.plantId,
    code:plants.code,pdfReadyAt:picklistHeaders.pdfReadyAt,
  }).from(picklistHeaders).innerJoin(plants,eq(picklistHeaders.plantId,plants.id));
  const counters = await db.select().from(sequences);
  const pending:number[]=[];
  const storage = resolve(fileURLToPath(new URL('../apps/api/', import.meta.url)),process.env.STORAGE_DIR ?? './storage','picklist');
  let verifiedFiles=0;
  for (const row of rows) {
    assert.match(row.no,/^[789][0-9]{9}00$/);
    assert.equal(row.no[0],orderPlantInitial(row.code));
    const root = rows.find((item)=>item.no===row.no&&item.revision===0);
    assert(root);
    assert.equal(row.no.slice(1,7),root.deliveryDate.slice(2).replaceAll('-',''));
    const counter = counters.find((item)=>item.code==='OS'+row.no[0]&&item.dateKey===row.no.slice(1,7));
    assert(counter&&counter.lastNo>=Number(row.no.slice(7,10)));
    assert.match(orderSheetDisplayNo(row.no,row.revision),/^[789][0-9]{11}$/);
    const before=backup.orders.find((item:any)=>item.id===row.id);
    assert(before);
    if (!row.pdfReadyAt) { pending.push(row.id); continue; }
    for(const kind of ['picklist','kanban','csv']) {
      const filename = join(storage,row.no+'-r'+row.revision+'-'+kind+(kind==='csv'?'.csv':'.pdf'));
      assert((await stat(filename)).size>0);
      if(kind==='csv') {
        const csv=(await readFile(filename)).toString('utf16le');
        assert(csv.includes(orderSheetDisplayNo(row.no,row.revision)), 'Nomor CSV harus baru');
        assert(!csv.includes('PL-'), 'CSV tidak boleh memuat nomor order lama');
      }
      verifiedFiles++;
    }
  }
  for(const item of await db.select().from(sapOutbox)){
    const payload=item.payload as Record<string,unknown>;
    assert(!String(payload.deliveryNote).startsWith('PL-'));
  }
  assert.equal(rows.length,backup.orders.length);
  console.log(JSON.stringify({orders:rows.length,pending,verifiedFiles,storage},null,2));
  assert.equal(pending.length,0,'Render PDF belum selesai');
}
main().catch((error)=>{console.error(error);process.exitCode=1}).finally(closeDb);
