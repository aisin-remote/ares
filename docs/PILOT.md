# Panduan pilot Fase 1

Panduan ini menyiapkan server uji dan menjalankan kriteria Fase 1 PRD §12.
Checklist hardening VPS di [`SECURITY.md`](SECURITY.md) wajib diselesaikan
sebelum server dapat diakses internet. Pilot menjalankan 20 Order Sheet manual
untuk dua supplier, dari penerbitan sampai penerimaan
dan outbox GR. Mode `fake` memvalidasi alur ARES tanpa menulis ke SAP.

Untuk penjelasan alur harian yang lebih ringkas bagi PPIC, supplier, warehouse,
admin, dan tim MES, buka [`USER-FLOW.html`](USER-FLOW.html).

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
DATABASE_URL=mysql://ares_api:<password-acak>@127.0.0.1:3306/ares
WEB_DATABASE_URL=mysql://ares_web:<password-acak-lain>@127.0.0.1:3306/ares
REDIS_URL=redis://127.0.0.1:6379
JWT_SECRET=<hasil-openssl-rand-base64-48>
ADMIN_INITIAL_PASSWORD=<password-admin-acak-minimal-15-karakter>
DEMO_INTERNAL_PASSWORD=<password-user-internal-uji-minimal-15-karakter>
DEMO_SUPPLIER_PASSWORD=<password-supplier-uji-acak-minimal-15-karakter>
API_HOST=127.0.0.1
TRUST_PROXY_HOPS=1
WEB_ORIGIN=https://ares.example.com
NEXT_PUBLIC_API_URL=https://api.ares.example.com
API_URL=http://127.0.0.1:3001
SEED_DEMO=on
SAP_GATEWAY=fake
SAP_SLOC=<sloc-uji-yang-disetujui>
DISPLAY_DEVICE_CODE=RECEIVING-TV-01
DISPLAY_DEVICE_TOKEN=<token-acak-monitor>
SMTP_HOST=<host-relay-email>
SMTP_PORT=587
SMTP_USER=<user-smtp-bila-diperlukan>
SMTP_PASS=<password-smtp-bila-diperlukan>
SMTP_FROM="ARES e-Kanban <no-reply@aiia.co.id>"
```

`SEED_DEMO=on` membuat dua master supplier contoh, empat part, PO terbuka,
cutoff, akun uji untuk setiap role, dan satu akun untuk setiap vendor di master.
Hapus atau ubah kembali menjadi `off` setelah seed; seed produksi tanpa flag ini
hanya membuat pabrik, peran, permission, dan admin.

`DISPLAY_DEVICE_TOKEN` hanya dibaca saat seed pertama kali membuat perangkat.
Setelah seed berhasil, hapus nilai token dari `.env`; ARES menyimpan hash-nya di
database. Buka `http://<ip-server>:3000/display/setup` di PC monitor, masukkan
kode dan token tersebut sekali, lalu layar berpindah ke `/display/receiving`.
Mode ini read-only, memperbarui Gantt tiap dua menit, memperpanjang sesi
perangkat otomatis, dan kembali ke setup bila perangkat dinonaktifkan.

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
| Administrator | `ADMIN` / nilai `ADMIN_INITIAL_PASSWORD` | admin | Ganti password segera setelah setup. |
| PPIC pilot | `PPIC01` / nilai `DEMO_INTERNAL_PASSWORD` | ppic | Dibuat seed demo. |
| Gudang pilot | `GUDANG01` / nilai `DEMO_INTERNAL_PASSWORD` | warehouse | Dibuat seed demo. |
| Produksi pilot | `PRODUKSI01` / nilai `DEMO_INTERNAL_PASSWORD` | produksi | Dibuat seed demo. |
| Setiap supplier | `<kode_vendor>@aiia.co.id` / nilai `DEMO_SUPPLIER_PASSWORD` | supplier | Dibuat seed demo dan terikat ke satu vendor. Spasi/tanda baca kode menjadi `_`, misalnya `FUJI SEIKI` → `fuji_seiki@aiia.co.id`. |
| Monitor receiving | `RECEIVING-TV-01` / token dari `.env` | device | Pairing sekali di `/display/setup`; bukan akun user/guest. |

PPIC, gudang, dan supplier memakai browser/profil terpisah supaya cookie login
tidak saling menggantikan. Catat operator, waktu mulai, nomor Order Sheet, nomor
receipt, hasil, dan temuan untuk setiap skenario.

## 3. Data dan aturan pelaksanaan

1. PPIC memeriksa vendor, part, vendor-part, cutoff, kebijakan pembulatan,
   hari libur, dan jadwal receiving dari layar master/setting serta dashboard.
2. Seed mengimpor 56 supplier unik: 39 dari `SUPPLIER LIST` dan 17 supplier
   ELECTRIC dari sheet `NEW` pada `List Suppllier Cycle Issue.xlsx`.
3. Admin mengisi **Nomor vendor SAP** untuk supplier BODY/UNIT yang dipakai lalu
   mengaktifkannya. Supplier ELECTRIC berkode `7D…` sudah aktif; HAGIWARA masih
   nonaktif karena sumber hanya berisi `-`.
4. Setting Cutoff berisi 39 template BODY/UNIT yang masih perlu dilengkapi dan
   11 cutoff ELECTRIC aktif sesuai hari serta jam pada workbook. Enam supplier
   ELECTRIC bertanda `By Schedule` tidak memiliki cutoff tetap dan harus
   dijadwalkan PPIC saat datanya tersedia.
5. Auto ordering menambahkan lead days, kemudian memilih tanggal delivery
   berikutnya yang diizinkan oleh periode `DAY` supplier. Jadwal yang masih
   nonaktif tidak pernah menerbitkan Order Sheet otomatis.
6. Jika supplier mengirim kurang, sistem otomatis membuat Order Sheet recovery.
   Nomor plant, tanggal, dan nomor urut tetap sama; dua digit terakhir naik dari
   `00` ke `01`, lalu `02`, dan seterusnya.
7. PPIC boleh memilih supplier aktif mana pun tanpa dibatasi plant supplier.
   Plant transaksi dan initial nomor Order Sheet tetap mengikuti plant Aisin
   akun PPIC: BODY `7`, UNIT `8`, dan ELECTRIC `9`.
8. Setiap Order Sheet memakai minimal satu vendor-part dan jumlah 1–3 box.
9. Unduh PDF dan CSV supplier, lalu scan barcode dari PDF hasil sistem. Untuk uji perangkat,
   gunakan scanner yang akan dipakai di gudang.
10. Setelah receipt ditutup, gunakan **Kumpulkan sekarang** di menu **SAP**. Pada
    mode fake, GR melewati antrean worker lalu menjadi `POSTED` dan memperoleh
    nomor `FAKE-<id>`. Status `PENDING` berarti menunggu worker, `PROCESSING`
    berarti sedang dikirim, dan `STAGED` berarti sudah masuk staging tetapi SAP
    belum mengembalikan nomor dokumen.
11. Jangan menjalankan SQL pada skenario normal. Satu pengecualian ada di PL-08
   untuk membentuk kegagalan teknis yang diperlukan guna menguji tombol retry.

Workbook BODY/UNIT tidak memuat nomor vendor SAP. Jangan mengarang nomor SAP dari
nama supplier. Daftar ELECTRIC memakai kode `7D…` dari workbook sebagai nomor
vendor dan hari shipping sebagai cutoff dengan lead day 0.

## 4. Skenario 20 Order Sheet

| ID | Supplier | Skenario | Hasil yang harus terlihat |
|---|---|---|---|
| PL-01 | Sinar Logam | Unduh, konfirmasi penuh, scan semua box, tutup. | Order Sheet `COMPLETE`; GR `POSTED`; nomor `FAKE-*`. |
| PL-02 | Sinar Logam | Unduh dan konfirmasi penuh; scan satu barcode dua kali. | Scan kedua `DUPLICATE`; jumlah receipt tidak bertambah. |
| PL-03 | Sinar Logam | Biarkan belum diunduh. | Dashboard menambah “Belum diunduh” untuk supplier ini. |
| PL-04 | Sinar Logam | Unduh, jangan konfirmasi. | Dashboard memindahkan hitungan ke “Belum dikonfirmasi”. |
| PL-05 | Sinar Logam | Konfirmasi kirim kurang 1 box. | Line `SHORT`; Order Sheet recovery `RR=01` dibuat untuk box yang kurang. |
| PL-06 | Sinar Logam | Konfirmasi penuh, scan sebagian, tutup dengan alasan. | Order Sheet `PARTIAL`; kanban tidak datang `MISSING`; stok hanya pcs diterima. |
| PL-07 | Sinar Logam | Scan semua dan tutup; batalkan receipt sebelum mengumpulkan GR. | Receipt `CANCELLED`; stok dikoreksi; kanban/Order Sheet pulih; GR tidak terkirim. |
| PL-08 | Sinar Logam | Tutup receipt, kumpulkan, ubah outbox uji menjadi `FAILED`, klik tahan, lalu retry. | Status tetap `HELD` sampai retry; sesudah retry dijadwalkan ulang dan akhirnya `POSTED`, nomor `FAKE-*`, audit `HOLD/RETRY`. |
| PL-09 | Sinar Logam | Saat sesi terbuka, scan kanban dari PL-01. | `REJECTED`; kanban asing dan counter tidak berubah. |
| PL-10 | Sinar Logam | Batalkan Order Sheet sebelum dikirim. | Order Sheet dan seluruh kanban `CANCELLED`; tidak dapat dibuka di receiving. |
| PL-11 | Karya Rubber | Unduh, konfirmasi penuh, terima penuh. | Order Sheet `COMPLETE`; GR fake terkirim. |
| PL-12 | Karya Rubber | Jangan unduh/konfirmasi; langsung scan seluruh kanban di gudang. | Receipt selesai; event `SHIPPED_AUTO` tercatat. |
| PL-13 | Karya Rubber | Konfirmasi kurang 1 box. | Recovery `RR=01` dibuat dengan sisa box dan kanban yang sama. |
| PL-14 | Karya Rubber | Unduh dan konfirmasi revisi dari PL-13, lalu terima. | Revisi dapat diproses tanpa menggandakan kanban. |
| PL-15 | Karya Rubber | Buka sesi, scan satu box, batalkan saat status masih `OPEN`. | Receipt `CANCELLED`; kanban kembali ke status sebelum scan. |
| PL-16 | Karya Rubber | Tutup receipt tanpa satu pun scan dengan alasan. | Semua kanban `MISSING`; outbox `SKIPPED`. |
| PL-17 | Karya Rubber | Coba tutup receipt parsial tanpa alasan. | API/UI menolak; setelah alasan diisi receipt dapat ditutup. |
| PL-18 | Karya Rubber | Terima penuh dan kumpulkan GR, lalu batalkan receipt. | Receipt `CANCELLED`; stok dibalik; kanban kembali `SHIPPED`; outbox `GR_REVERSAL` movement 102 menjadi `POSTED` dengan nomor `FAKE-*`. |
| PL-19 | Karya Rubber | Buat Order Sheet dua part, konfirmasi dan terima penuh. | Dua receipt line dan dua item payload GR dengan qty pcs benar. |
| PL-20 | Karya Rubber | Ulangi alur penuh sambil memantau dashboard. | Jumlah status hari ini dan daftar supplier berubah sesuai setiap aksi. |

Untuk PL-08, jalankan hanya di database uji setelah GR dibuat dan sebelum klik
retry:

```sql
UPDATE TT_SAP_OUTBOX
SET STATUS='FAILED', ATTEMPTS=8, LAST_ERROR='Simulasi jaringan pilot'
WHERE SOURCE_TABLE='TT_RECEIPT_H' AND SOURCE_ID=<receipt-id> AND DOC_TYPE='GR';
```

PL-18 membuktikan F-40 lengkap, termasuk idempotency key `<receiptNo>:REV` dan
jejak audit pembatalannya.

## 5. Kriteria lulus dan bukti

Pilot Fase 1 lulus bila:

- seluruh 20 baris memiliki hasil aktual dan bukti nomor Order Sheet/receipt;
- kedua supplier dapat login, mengunduh PDF, dan mengonfirmasi kirim dengan
  data mereka sendiri saja;
- scanner fisik membaca barcode Order Sheet dan kanban, termasuk hasil duplicate
  dan rejected;
- jumlah box/pcs pada Order Sheet, receipt, mutasi stok, dan payload GR cocok;
- setiap GR normal berakhir `POSTED` dengan nomor `FAKE-*`, sedangkan receipt
  tanpa pcs menjadi `SKIPPED`;
- dashboard menampilkan status Order Sheet hari ini, supplier tertinggal, dan GR
  gagal dari data transaksi;
- `TT_AUDIT_LOG` berisi issue/cancel/confirm shipment, open/close/cancel receipt,
  serta retry outbox dengan user dan before/after;
- tidak ada error tak terjelaskan di log API/worker dan `pnpm typecheck &&
  pnpm test` tetap hijau pada revisi yang diuji.

Mode fake hanya mengesahkan alur ARES. Sebelum koneksi SAP dinyatakan lulus,
ubah `SAP_GATEWAY=mssql`, lengkapi staging yang disepakati tim SAP, lalu ulangi
setidaknya PL-01, PL-07, PL-08, PL-18, dan PL-19 di lingkungan QA SAP.
