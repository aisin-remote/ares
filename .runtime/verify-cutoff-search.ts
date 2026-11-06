import assert from 'node:assert/strict';
import { getNextCutoffPreviews, listMaster } from '../apps/web/src/lib/queries';
import { closeDb } from '../packages/db/dist/index';

async function main() {
  const previews = await getNextCutoffPreviews();
  const supplier = previews.find((item) => item.vendorName === 'PT Karya Rubber Nusantara');
  assert(supplier, 'Supplier pada kartu kalender harus tersedia');
  assert(supplier.vendorCode, 'Kode SAP supplier tersedia untuk tautan pengaturan');
  const byName = await listMaster('vendorCutoffs', { page: 1, perPage: 25, q: supplier.vendorName });
  const byCode = await listMaster('vendorCutoffs', { page: 1, perPage: 25, q: supplier.vendorCode });
  const partial = await listMaster('vendorCutoffs', { page: 1, perPage: 25, q: 'rubber' });
  assert(byName.data.length > 0, 'Nama supplier harus menemukan jadwal cutoff');
  assert(byName.data.every((row) => row.vendorId === supplier.vendorId));
  assert.deepEqual(byName.data.map((row) => row.id), byCode.data.map((row) => row.id));
  assert(partial.data.some((row) => row.vendorId === supplier.vendorId), 'Pencarian nama parsial tidak peka kapital');
  const paged = await listMaster('vendorCutoffs', { page: 1, perPage: 1, q: supplier.vendorName });
  assert.equal(paged.meta.total, byName.meta.total, 'Total filter tidak berubah saat paginasi');
  const empty = await listMaster('vendorCutoffs', { page: 1, perPage: 25, q: 'supplier-tidak-ada-9ff52b' });
  assert.equal(empty.meta.total, 0);
  assert.equal(empty.data.length, 0);
  console.log(JSON.stringify({ supplier: supplier.vendorName, code: supplier.vendorCode,
    schedules: byName.data.map((row) => ({ id: row.id, cutoff: row.cutoffTime, active: row.isActive })) }));
  console.log('Lulus: pencarian nama, kode SAP, parsial, total paginasi, hasil kosong, dan pemetaan kartu kalender.');
}
main().finally(closeDb).catch((error) => { console.error(error); process.exitCode = 1; });
