const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const dbRequire = createRequire(path.join(root, 'packages/db/package.json'));
dbRequire('dotenv').config({path: path.join(root, '.env')});
const mysql = dbRequire('mysql2/promise');
const bcrypt = dbRequire('bcryptjs');
const api = process.env.API_URL || 'http://127.0.0.1:3002';
const web = 'http://127.0.0.1:3000';
for (const url of [api, web]) assert(['127.0.0.1', 'localhost'].includes(new URL(url).hostname));
const checks = [];
function check(name, condition) { assert(condition, name); checks.push(name); }
async function page(url, token, options = {}) {
  const response = await fetch(web + url, {redirect:'manual', ...options, headers: token ? {Cookie:`__Host-ares_token=${token}; ares_token=${token}`} : {}});
  return {response, html:await response.text()};
}
function redirected(result, destination) {
  return result.response.headers.get('location') === destination || result.html.includes(`url=${destination}`);
}
async function main() {
  const connection = await mysql.createConnection(process.env.WEB_DATABASE_URL || process.env.DATABASE_URL);
  try {
    const [accounts] = await connection.execute('SELECT u.NPK AS npk, u.PASSWORD_HASH AS hash, u.PLANT_ID AS plantId, r.NAME AS role FROM TM_USER u JOIN TM_ROLE r ON r.ID=u.ROLE_ID WHERE u.NPK IN (?, ?) AND u.IS_ACTIVE=1', ['GUDANG01','ADMIN']);
    const tokens = {};
    for (const account of accounts) {
      const candidates = [...new Set([process.env.DEMO_INTERNAL_PASSWORD?.trim(), process.env.ADMIN_INITIAL_PASSWORD?.trim(), 'user123', 'admin123'].filter(Boolean))];
      let matched;
      for (const candidate of candidates) { if (await bcrypt.compare(candidate, account.hash)) { matched = candidate; break; } }
      assert(matched, `Password uji ${account.role} tidak cocok`);
      const response = await fetch(api + '/auth/login', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({npk:account.npk,password:matched})});
      check(`Login ${account.role} berhasil`, response.ok);
      const body = await response.json();
      assert(body.accessToken, 'Token login tidak tersedia');
      tokens[account.role] = {token:body.accessToken, plantId:account.plantId};
    }
    assert(tokens.warehouse && tokens.admin, 'Dua akun uji wajib tersedia');
    const warehouse = tokens.warehouse.token;
    check('Gudang membuka beranda langsung ke Receiving', redirected(await page('/', warehouse), '/receiving'));
    check('Bookmark Dashboard gudang diarahkan ke Receiving', redirected(await page('/dashboard', warehouse), '/receiving'));
    const home = await page('/receiving', warehouse);
    check('Receiving gudang berhasil dimuat', home.response.ok);
    check('Receiving gudang memakai navigasi handheld', home.html.includes('aria-label="Menu gudang"'));
    check('Receiving gudang dibatasi satu kolom', home.html.includes('max-w-[560px]'));
    check('Receiving gudang tidak merender sidebar desktop', !home.html.includes('aria-label="Minimalkan sidebar"'));
    check('Daftar sesi gudang memakai kartu tanpa tabel', !/<table\b/.test(home.html));
    check('Form scanner gudang tersedia dengan keyboard ditahan', home.html.includes('inputMode="none"') || home.html.includes('inputmode="none"'));
    check('Saringan awal menampilkan semua sesi', /href="\/receiving\?status=ALL"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/receiving\?status=ALL"/.test(home.html));
    const closed = await page('/receiving?status=CLOSED', warehouse);
    check('Riwayat sesi ditutup dapat dibuka', closed.response.ok && closed.html.includes('Lihat hasil penerimaan'));
    const [receipts] = await connection.execute('SELECT PUBLIC_ID AS id, STATUS AS status FROM TT_RECEIPT_H WHERE PLANT_ID=? AND STATUS IN (?, ?) ORDER BY ID DESC', [tokens.warehouse.plantId,'OPEN','CLOSED']);
    for (const status of ['OPEN','CLOSED']) {
      const receipt = receipts.find(row => row.status === status);
      assert(receipt, `Sesi ${status} untuk uji belum tersedia`);
      const result = await page(`/receiving/${receipt.id}${status === 'CLOSED' ? '/ringkasan' : ''}`, warehouse);
      check(`Halaman sesi ${status} berhasil dimuat`, result.response.ok);
      check(`Halaman sesi ${status} tanpa sidebar desktop`, !result.html.includes('aria-label="Minimalkan sidebar"'));
      if (status === 'OPEN') {
        check('Sesi scan gudang tetap selebar handheld', result.html.includes('@container min-h-screen bg-surface mx-auto w-full max-w-[560px]'));
        check('Form scan kanban tersedia', result.html.includes('aria-label="QR kanban"'));
      } else {
        check('Ringkasan gudang memakai kartu part', result.html.includes('Hasil penerimaan') && !/<table\b/.test(result.html));
        check('Ringkasan gudang tidak menautkan menu SAP terbatas', !result.html.includes('href="/sap"'));
      }
    }
    check('Admin tetap masuk Dashboard', redirected(await page('/', tokens.admin.token), '/dashboard'));
    const adminReceiving = await page('/receiving', tokens.admin.token);
    check('Receiving admin tetap memakai sidebar desktop', adminReceiving.response.ok && adminReceiving.html.includes('aria-label="Minimalkan sidebar"'));
    check('Receiving admin tetap memakai tabel', /<table\b/.test(adminReceiving.html));
    for (const role of ['admin', 'warehouse']) {
      const [expected] = await connection.execute('SELECT RECEIPT_NO AS receiptNo, STATUS AS status FROM TT_RECEIPT_H WHERE PLANT_ID=? ORDER BY (STATUS=?) DESC, ID DESC LIMIT 25', [tokens[role].plantId, 'OPEN']);
      const result = await page('/receiving', tokens[role].token);
      let previous = -1;
      for (const receipt of expected) {
        const position = result.html.indexOf(receipt.receiptNo);
        check(`${role}: ${receipt.receiptNo} muncul sesuai urutan`, position > previous);
        previous = position;
      }
      check(`${role}: semua status tetap tampil`, expected.some(r => r.status === 'OPEN') && expected.some(r => r.status !== 'OPEN'));
      const openOnly = await page('/receiving?status=OPEN', tokens[role].token);
      check(`${role}: filter Terbuka tetap bekerja`, expected.filter(r => r.status !== 'OPEN').every(r => !openOnly.html.includes(r.receiptNo)));
    }
    const logout = await page('/api/logout', warehouse, {method:'POST'});
    check('Tombol keluar mengarahkan ke login', logout.response.status === 303 && logout.response.headers.get('location') === '/login');
    check('Cookie sesi dihapus saat keluar', /Max-Age=0/i.test(logout.response.headers.get('set-cookie') || ''));
    check('Receiving tanpa login tetap terlindungi', redirected(await page('/receiving'), '/login'));
    const report = {checks:checks.length, passed:checks};
    fs.writeFileSync(path.join(__dirname,'warehouse-layout-check.json'), JSON.stringify(report,null,2));
    console.log(JSON.stringify(report,null,2));
  } finally { await connection.end(); }
}
main().catch(error => { console.error(error.message); process.exitCode=1; });
