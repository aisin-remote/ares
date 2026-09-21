# Panduan pilot Fase 1

Panduan ini menyiapkan server uji dan menjalankan kriteria Fase 1 PRD §12:
20 picklist manual untuk dua supplier pilot, dari penerbitan sampai penerimaan
dan outbox GR. Mode `fake` memvalidasi alur ARES tanpa menulis ke SAP.

## 1. Siapkan server uji

Prasyarat: Node.js 20+, pnpm 9.15.9, Docker, dan akses browser dari jaringan
pilot. Jalankan dari root repository:

```bash
pnpm install --frozen-lockfile
cp .env.example .env
pnpm infra:up
pnpm db:migrate
pnpm db:seed
pnpm typecheck && pnpm test
pnpm build
```

Isi `.env` sebelum migrasi/seed:

```dotenv
NODE_ENV=production
DATABASE_URL=mysql://ares:ares@127.0.0.1:3306/ares
REDIS_URL=redis://127.0.0.1:6379
JWT_SECRET=<rahasia acak minimal 16 karakter>
WEB_ORIGIN=http://<ip-server>:3000
NEXT_PUBLIC_API_URL=http://<ip-server>:3001
API_URL=http://127.0.0.1:3001
SEED_DEMO=on
SAP_GATEWAY=fake
SAP_SLOC=<sloc-uji-yang-disetujui>
```

`SEED_DEMO=on` membuat dua supplier, empat part, PO terbuka, cutoff, dan dua
akun supplier. Hapus atau ubah kembali menjadi `off` setelah seed; seed produksi
tanpa flag ini hanya membuat pabrik, peran, permission, dan admin.

Jalankan dua proses dengan service manager yang dapat memulai ulang proses saat
server reboot:

```bash
pnpm --filter @ares/api start
pnpm --filter @ares/web start
```

Periksa `GET http://<ip-server>:3001/health/ready`, lalu login ke
`http://<ip-server>:3000`. Di `/sap`, banner harus menyatakan gateway `fake`
aktif. Nomor dokumen hasil uji harus berbentuk `FAKE-<id>`.

## 2. Akun pilot

| Pemakai | Login awal | Peran | Persiapan |
|---|---|---|---|
| Administrator | `ADMIN` / `admin123` | admin | Ganti password segera setelah setup. |
| PPIC pilot | `PPIC01` | ppic | Buat dari Master User, pasang password sementara. |
| Gudang pilot | `GUDANG01` | warehouse | Buat dari Master User, pasang password sementara. |
| PT Sinar Logam Presisi | `ppc@sinarlogam.co.id` / `supplier123` | supplier | Dibuat seed demo, terikat vendor `0000100231`. |
| PT Karya Rubber Nusantara | `sales@karyarubber.co.id` / `supplier123` | supplier | Dibuat seed demo, terikat vendor `0000100544`. |

PPIC, gudang, dan supplier memakai browser/profil terpisah supaya cookie login
tidak saling menggantikan. Catat operator, waktu mulai, nomor picklist, nomor
receipt, hasil, dan temuan untuk setiap skenario.

## 3. Data dan aturan pelaksanaan

1. PPIC memeriksa vendor, part, vendor-part, cutoff, kebijakan short shipment,
   dan hari libur dari layar master/setting.
2. Set kebijakan Sinar Logam ke `CARRY_OVER` dan Karya Rubber ke `REVISION`.
3. Setiap picklist memakai minimal satu vendor-part dan jumlah 1–3 box.
4. Unduh PDF dan scan barcode dari PDF hasil sistem. Untuk uji perangkat,
   gunakan scanner yang akan dipakai di gudang.
5. Setelah receipt ditutup, gunakan **Kumpulkan sekarang** di `/sap`. Pada mode
   fake, GR berubah menjadi `SENT` dan memperoleh nomor `FAKE-<id>`.
6. Jangan menjalankan SQL pada skenario normal. Satu pengecualian ada di PL-08
   untuk membentuk kegagalan teknis yang diperlukan guna menguji tombol retry.

## 4. Skenario 20 picklist

| ID | Supplier | Skenario | Hasil yang harus terlihat |
|---|---|---|---|
| PL-01 | Sinar Logam | Unduh, konfirmasi penuh, scan semua box, tutup. | Picklist `COMPLETE`; GR `SENT`; nomor `FAKE-*`. |
| PL-02 | Sinar Logam | Unduh dan konfirmasi penuh; scan satu barcode dua kali. | Scan kedua `DUPLICATE`; jumlah receipt tidak bertambah. |
| PL-03 | Sinar Logam | Biarkan belum diunduh. | Dashboard menambah “Belum diunduh” untuk supplier ini. |
| PL-04 | Sinar Logam | Unduh, jangan konfirmasi. | Dashboard memindahkan hitungan ke “Belum dikonfirmasi”. |
| PL-05 | Sinar Logam | Konfirmasi kirim kurang 1 box dengan `CARRY_OVER`. | Line `SHORT`; kanban sisa `CANCELLED`; tidak ada revisi. |
| PL-06 | Sinar Logam | Konfirmasi penuh, scan sebagian, tutup dengan alasan. | Picklist `PARTIAL`; kanban tidak datang `MISSING`; stok hanya pcs diterima. |
| PL-07 | Sinar Logam | Scan semua dan tutup; batalkan receipt sebelum mengumpulkan GR. | Receipt `CANCELLED`; stok dikoreksi; kanban/picklist pulih; GR tidak terkirim. |
| PL-08 | Sinar Logam | Tutup receipt, kumpulkan, ubah outbox uji menjadi `FAILED`, klik tahan, lalu retry. | Status tetap `HELD` sampai retry; sesudah retry menjadi `SENT`, `ATTEMPTS=1`, nomor `FAKE-*`, audit `HOLD/RETRY`. |
| PL-09 | Sinar Logam | Saat sesi terbuka, scan kanban dari PL-01. | `REJECTED`; kanban asing dan counter tidak berubah. |
| PL-10 | Sinar Logam | Batalkan picklist sebelum dikirim. | Picklist dan seluruh kanban `CANCELLED`; tidak dapat dibuka di receiving. |
| PL-11 | Karya Rubber | Unduh, konfirmasi penuh, terima penuh. | Picklist `COMPLETE`; GR fake terkirim. |
| PL-12 | Karya Rubber | Jangan unduh/konfirmasi; langsung scan seluruh kanban di gudang. | Receipt selesai; event `SHIPPED_AUTO` tercatat. |
| PL-13 | Karya Rubber | Konfirmasi kurang 1 box dengan `REVISION`. | Revisi 1 dibuat dengan sisa box dan kanban yang sama. |
| PL-14 | Karya Rubber | Unduh dan konfirmasi revisi dari PL-13, lalu terima. | Revisi dapat diproses tanpa menggandakan kanban. |
| PL-15 | Karya Rubber | Buka sesi, scan satu box, batalkan saat status masih `OPEN`. | Receipt `CANCELLED`; kanban kembali ke status sebelum scan. |
| PL-16 | Karya Rubber | Tutup receipt tanpa satu pun scan dengan alasan. | Semua kanban `MISSING`; outbox `SKIPPED`. |
| PL-17 | Karya Rubber | Coba tutup receipt parsial tanpa alasan. | API/UI menolak; setelah alasan diisi receipt dapat ditutup. |
| PL-18 | Karya Rubber | Terima penuh dan kumpulkan GR, lalu coba batalkan receipt. | Pembatalan ditolak karena GR sudah `SENT`; data tidak berubah dan GR pembalik dicatat sebagai batas pilot. |
| PL-19 | Karya Rubber | Buat picklist dua part, konfirmasi dan terima penuh. | Dua receipt line dan dua item payload GR dengan qty pcs benar. |
| PL-20 | Karya Rubber | Ulangi alur penuh sambil memantau dashboard. | Jumlah status hari ini dan daftar supplier berubah sesuai setiap aksi. |

Untuk PL-08, jalankan hanya di database uji setelah GR dibuat dan sebelum klik
retry:

```sql
UPDATE TT_SAP_OUTBOX
SET STATUS='FAILED', ATTEMPTS=8, LAST_ERROR='Simulasi jaringan pilot'
WHERE SOURCE_TABLE='TT_RECEIPT_H' AND SOURCE_ID=<receipt-id> AND DOC_TYPE='GR';
```

PL-18 membuktikan pagar F-40 yang ada sekarang. Baris GR pembalik 102 belum
dibuat otomatis; catat kebutuhan tersebut sebagai temuan yang sudah diketahui,
sesuai `docs/PENDING.md`.

## 5. Kriteria lulus dan bukti

Pilot Fase 1 lulus bila:

- seluruh 20 baris memiliki hasil aktual dan bukti nomor picklist/receipt;
- kedua supplier dapat login, mengunduh PDF, dan mengonfirmasi kirim dengan
  data mereka sendiri saja;
- scanner fisik membaca barcode picklist dan kanban, termasuk hasil duplicate
  dan rejected;
- jumlah box/pcs pada picklist, receipt, mutasi stok, dan payload GR cocok;
- setiap GR normal berakhir `SENT` dengan nomor `FAKE-*`, sedangkan receipt
  tanpa pcs menjadi `SKIPPED`;
- dashboard menampilkan status picklist hari ini, supplier tertinggal, dan GR
  gagal dari data transaksi;
- `TT_AUDIT_LOG` berisi issue/cancel/confirm shipment, open/close/cancel receipt,
  serta retry outbox dengan user dan before/after;
- tidak ada error tak terjelaskan di log API/worker dan `pnpm typecheck &&
  pnpm test` tetap hijau pada revisi yang diuji.

Mode fake hanya mengesahkan alur ARES. Sebelum koneksi SAP dinyatakan lulus,
ubah `SAP_GATEWAY=mssql`, lengkapi staging yang disepakati tim SAP, lalu ulangi
setidaknya PL-01, PL-07, PL-08, PL-18, dan PL-19 di lingkungan QA SAP.
