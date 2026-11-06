# Pending ARES

Daftar hal yang menggantung: verifikasi yang belum bisa dijalankan, keputusan
yang menunggu orang, dan utang kecil yang sengaja ditunda. Bukan backlog fitur —
fitur ada di `docs/PRD.md` bagian 12.

Aturan main: satu baris selesai → hapus dari sini, jangan dibiarkan jadi arsip.

Terakhir diperbarui: 2026-10-18 (akun supplier internal dengan OTP email).

## 1. Verifikasi yang belum jalan

- [ ] **Halaman `/portal/vendor-part` belum dilihat di browser** (servis dan
      aturannya teruji lewat vitest: hanya kolom kemasan, hanya baris sendiri,
      audit `UPDATE_BY_VENDOR`). Cek dengan akun supplier: ubah back number →
      tersimpan, dan email kabar ke PPIC muncul di log API (tanpa SMTP) atau di
      kotak masuk PPIC (dengan SMTP).

- [ ] **Audit kerentanan dependency belum dapat dijalankan dari jaringan ini.**
      `pnpm audit --prod` ke npmjs ditolak FortiGate (HTTP 403), sedangkan mirror
      `.npmrc` tidak menyediakan endpoint audit. Jalankan perintah itu di CI atau
      jaringan yang mengizinkan registry npm sebelum go-live.

- [ ] **Alat BOM di `/master/bom` dan penyesuaian stok belum dicoba di browser**
      (API & DB-nya teruji lewat vitest: import Excel 2 level → explode, dan
      adjust + audit). Cek: `/master/bom` → unggah xlsx 5 kolom → ringkasan
      baru/diperbarui/dilewati; pratinjau urai menampilkan level & daun;
      `/stock` → klik part → sesuaikan dengan alasan → baris ADJUST muncul di
      buku mutasi, lalu jalankan `POST /stock/snapshot` dan pastikan saldo di
      `/stock` tidak berubah.
      (2026-09-26: daftar `/stock` sendiri sudah dilihat — saldo, saringan
      supplier, pencarian part, dan buku mutasi `/stock/1` benar.)

- [ ] **Job snapshot stok belum diuji pada volume sungguhan.** `snapshot-stock`
      jalan tiap 00.20 (`STOCK_SNAPSHOT_CRON`) dan membekukan saldo per
      plant+part; `/stock` membaca snapshot terakhir + mutasi sesudahnya, dan
      otomatis kembali menjumlahkan seluruh riwayat bila snapshot kosong. Diuji
      di dev dengan 7 baris mutasi (kedua jalur memberi 914 pcs yang sama) dan
      diukur pada 2 juta baris sintetis di tabel salinan (0,5–1,2 detik untuk
      cara lama). Di server pilot: biarkan berjalan seminggu, lalu bandingkan
      `/stock` dengan `select PART_ID, sum(DELTA_PCS) from TT_STOCK_MUTATION`.
- [ ] **Menu fase** (`NEXT_PUBLIC_ARES_PHASE`): `.env` dev = 2, jadi Antrean Order,
      Stok WH, Konsumsi, Sinkron MES, dan Performa Supplier F-50 tampil; laporan
      Konsumsi & Order (fase 3) belum. Di server
      pilot biarkan kosong (= 1). Nilai ini dibaca saat build/dev Next — ubah →
      restart `pnpm dev`.

- [ ] **Pengiriman email lewat SMTP sungguhan belum dicoba.** `NotifyService`
      hanya diuji tanpa `SMTP_HOST` (isi email ke log; job `send-notification`
      selesai `{recipients:1, sent:false}` untuk terbit, revisi, dan pengingat).
      Isi `SMTP_*` di `.env` server uji, kirim satu order manual, pastikan email
      vendor, cc PPIC untuk reminder, dan tautan portalnya benar. Buat akun
      supplier dari menu User & Peran, lalu pastikan OTP login masuk ke email
      tersebut dan hanya dapat dipakai satu kali selama 5 menit.

- [ ] **Enter dari scanner keyboard-wedge sungguhan belum dicoba di layar stasiun.**
      Di browser uji, form scan hanya bisa disubmit lewat `form.requestSubmit()`
      (tombol Enter sintetis alat uji tidak memicu submit implisit); form-nya
      memang satu input tanpa tombol, yang di browser asli tersubmit oleh Enter.
      Coba dengan scanner fisik di PC gudang sebelum pilot.
- [ ] **`inputMode="none"` belum dicoba di scanner Android sungguhan.** Tujuannya
      menahan keyboard virtual saat scanner hardware menembak ke input yang fokus;
      tombol "Ketik manual" membukanya. Beberapa firmware scanner (mis. DataWedge
      mode keystroke) memerlukan fokus input yang benar-benar aktif — cek di
      perangkat pilot bahwa tembakan masuk tanpa keyboard muncul.
- [ ] **Layar stasiun belum dilihat di mode terang.** Di handheld (375 px) dan
      monitor (1440 px) sudah; tablet 768–1279 px memakai susunan handheld
      (kolom tunggal) — belum dilihat.

(Selain itu, 2026-09-21: layar stasiun diuji di browser dengan Order Sheet 11 & 42:
buka sesi → kanban Order Sheet lain DITOLAK → OK (tanpa konfirmasi supplier) →
SUDAH DISCAN → kode asing DITOLAK → tutup COMPLETE → ringkasan; lalu sesi kedua
1 dari 2 box → alasan wajib → PARTIAL, ringkasan menampilkan hilang 1. Alur
receiving lewat HTTP diverifikasi: open → 4 scan OK +
dobel DUPLICATE + kanban Order Sheet lain REJECTED + kode asing REJECTED → tutup tanpa
alasan 422 → tutup dengan alasan → Order Sheet PARTIAL, kanban #5 MISSING, 2 baris
TT_STOCK_MUTATION, dan cron `collect-sap-outbox` memungut receipt CLOSED jadi 1 baris
outbox PENDING (GR 101, key RCP-260921-0010) dalam 15 detik.)

## 2. Keputusan yang menunggu orang

- [ ] **Sumber bulan PO di staging SAP.** Aturan PPIC sudah pasti: PO awal–akhir bulan,
      recovery lintas bulan memakai PO baru. Validasi dan pemilihan recovery ARES sudah
      mengikuti periode itu. Tim SAP masih perlu menetapkan kolom sumber periode;
      jangan otomatis menganggap tanggal dibuat/sinkronisasi sebagai bulan bisnis PO.
      PO lama yang periodenya kosong/lintas bulan ditolak untuk penerbitan baru.

- [ ] **Definisi cycle**. Sekarang dihitung dari urutan **jam kedatangan**
      (`ARRIVAL_TIME`), mengikuti glosarium PRD §14 "kedatangan ke-n dalam satu
      hari". Perlu konfirmasi PPIC: di sistem lama, apakah cycle dihitung begitu
      atau dari urutan jam cutoff? Kartu yang sudah tercetak tidak ikut berubah
      (nilainya di-snapshot di `TT_PICKLIST_H.CYCLE`).
- [ ] **Alamat pabrik tujuan tidak ada di `TM_PLANT`**, jadi PDF Order Sheet hanya
      mencetak kode + nama pabrik. Kalau supplier butuh alamat kirim lengkap,
      tambah kolom `ADDRESS` ke `TM_PLANT`.
- [ ] **Sloc GR & stok WH = `SAP_SLOC` (default `WH00`, placeholder PRD §13).**
      Dipakai `TT_STOCK_MUTATION.SLOC` dan payload outbox GR. Begitu tim SAP
      menetapkan sloc, isi di `.env`; baris mutasi lama tidak dimigrasi otomatis.
- [ ] **Satu sesi scan OPEN per Order Sheet, bukan per perangkat (F-34).** Scan ulang
      barcode Order Sheet melanjutkan sesi yang ada (F-39). Kalau gudang memang memakai
      dua stasiun untuk satu truk, perlu `DEVICE_ID` di sesi + dedupe per sesi tetap.
      `TT_RECEIPT_H.DEVICE_ID` dan `TT_SCAN_EVENT.DEVICE_ID` sekarang selalu NULL
      (operator login sebagai user, token device belum dipakai di receiving).
      Ditandai `ponytail:` di `PicklistService.confirmShipment`.
- [ ] **Tanggal kirim revisi = tanggal asal + 1 hari kalender** (bukan hari kerja
      berikutnya, 6.2). Ikut diperbaiki bersama kalender cutoff fase 2; sampai
      itu PPIC mengecek tanggal revisi yang jatuh di akhir pekan/libur.
- [ ] **Order Sheet PARTIAL tidak bisa dibuka sesi baru** sampai revisi (F-25, fase 2) ada.
      Kanban MISSING dari sesi pertama baru bisa diterima lewat Order Sheet recovery;
      recovery setelah receipt PARTIAL belum dibuat otomatis.
- [ ] **Barang tanpa konfirmasi supplier tidak bisa diterima lagi** (2026-11-02).
      Sesi scan hanya dibuka dengan Delivery Sheet (`ARES:D:<DO#>`) yang terbit
      setelah konfirmasi kirim, jadi Order Sheet ISSUED/DOWNLOADED ditolak di gudang.
      Kalau truk datang sebelum supplier sempat konfirmasi, PPIC/supplier harus
      konfirmasi dulu di portal. Konfirmasi ke PPIC/WH apakah perlu jalur darurat.
      Jalur lama (`picklistStatusPathOnClose` ISSUED→SHIPPED, kanban `SHIPPED_AUTO`)
      masih ada di domain tapi tidak tercapai dari pembukaan sesi.
- [ ] **Delivery Sheet belum dilihat di browser / dicetak.** PDF dirender worker
      (`render-delivery-sheet`) setelah konfirmasi kirim dan koreksi PPIC; tombol
      unduh muncul di portal dan detail Order Sheet. Cek tampilan PDF, lalu scan
      barcode-nya di layar stasiun. Tidak ada kolom "siap"; klik sebelum worker
      selesai dijawab "belum selesai dibuat".
- [ ] **Receipt Sheet belum dilihat di browser / dicetak.** Dirender worker
      (`render-receipt-sheet`) saat sesi scan ditutup, disimpan di
      `storage/receipt/`, diunduh dari tombol "Receipt Sheet" di ringkasan receipt
      (`GET /receipts/:id/receipt-sheet.pdf`, hak `receipt.read`). Receipt batal
      tidak bisa dicetak. Isi QR = nomor receipt; "repeated no." = urutan receipt
      untuk DO yang sama, termasuk yang batal — konfirmasi definisi ini ke PPIC.
      Empat kotak tanda tangan di kanan bawah dibiarkan tanpa label seperti template.
- [ ] **Kontrak staging SAP masih menunggu tim SAP.** Jalur ARES sudah siap:
      outbox idempoten, validasi GR, worker terpisah, retry bertahap, serta status
      `PENDING/PROCESSING/STAGED/POSTED`. Yang belum boleh ditebak adalah nama
      tabel/kolom tujuan, arti flag siap/sukses/gagal, cara membaca nomor material
      document, movement reversal 102, kode plant dan sloc final, serta interval
      pembacaan staging oleh SAP. Sampai jawaban itu lengkap, gateway MSSQL tetap
      sengaja menolak kiriman dan mode pilot memakai `SAP_GATEWAY=fake`.
      Pembaruan 2026-11-02: konfigurasi koneksi `STAGING_*` dan diagnostik
      `pnpm --filter @ares/api staging:check` sudah tersedia. Lokal memakai
      `SAP_GATEWAY=mssql`, push/pull false. Database tujuan = `A_DB_STG`
      (2026-11-03; `aisinbisa_sap_stagging` hanya trial tim SAP). `A_DB_STG` adalah
      tabel penghubung: program VB tim SAP yang menarik data staging ke SAP asli
      dan (diduga) menulis hasilnya kembali. Koneksi
      berhasil dan delapan tabel utama pada schema `dbo` terverifikasi. Isinya
      salinan data trial (2026-11-03), bukan data SAP sungguhan — bersihkan
      sebelum SAP mulai membaca `A_DB_STG`. Sinkronisasi data, pengiriman GR, dan pembacaan hasil
      SAP masih menunggu implementasi. Detail ada di `docs/SAP-MM-MAPPING.md`.

## 3. Lingkungan pengembangan tidak sesuai dokumen

- [ ] **MySQL dev = 8.0.30 Laragon** (`C:\laragonin\mysql\mysql-8.0.30-winx64`,
      data dir `C:\laragon\data\mysql-8`, user `ares`/`ares`), bukan 8.4 seperti
      `docker-compose.yml`. Cukup dekat; jangan kembali ke 5.7 — CTE/window/`SKIP
      LOCKED` dibutuhkan fase 2. Redis dev 5.0.14 (BullMQ hanya memperingatkan);
      produksi tetap Valkey ≥ 7.
- [ ] **`docker-compose.yml` dan README tidak menggambarkan keadaan sebenarnya**
      (`pnpm infra:up` tidak dipakai; Laragon yang menyediakan MySQL & Redis).
      Samakan dokumen dengan kenyataan, atau kembali pakai docker.
- [ ] **Timestamp data demo lama meleset 7 jam.** Baris yang ditulis aplikasi
      sebelum perbaikan zona waktu di `packages/db/src/client.ts` (`CUTOFF_AT`,
      `SYNCED_AT`, event kanban) tersimpan bergeser. Isinya hanya data uji —
      bersihkan tabel transaksi Order Sheet saat mulai serius, atau biarkan.

- [ ] **GR di luar ARES tidak mengurangi sisa PO** (keputusan 2026-11-03: sisa =
      qty PO − pesanan ARES). Kalau gudang masih sering GR manual lewat MIGO,
      minta tim SAP menyediakan qty sudah-GR per item PO di staging.
- [ ] **Tarik PO terjadwal belum dicoba dengan data sungguhan.** Job harian
      00.30 WIB (`sap-sync-po`) membaca `TM_SETTING.PO_PULL_DAY` dan pada
      tanggal itu menarik PO yang dibuat bulan ini untuk bulan depan. Aktif hanya
      bila `STAGING_PULL_ENABLED=true`. Cek: ubah tanggal ke hari ini di layar
      SAP, nyalakan pull, restart API, besok pagi pastikan PO bulan depan muncul
      dan sisa PO tampil di form order manual.

- [ ] **Tarik master dari SAP belum dicoba dengan data sungguhan.** `A_DB_STG`
      masih berisi salinan trial (3 supplier, 3 part, 6 pasangan). Pratinjau aman
      dijalankan kapan saja; simpan butuh `STAGING_PULL_ENABLED=true`. Pastikan
      `CHR_WC_VENDOR` di `TM_KANBAN` memang berisi kode supplier SAP, dan isi pabrik
      + cutoff untuk supplier baru sebelum dipakai order.

## 4. Utang kecil yang sengaja ditunda

- [ ] **Ekuivalen box memakai qty/box terkecil** bila satu part dipasok beberapa
      supplier dengan kemasan berbeda (`listStock`, `getStockLedger`). Kalau PPIC
      butuh per supplier, tampilkan per vendor part — datanya sudah ada di kartu
      "Supplier & kemasan".
- [ ] **Upload BOM belum menutup versi lama otomatis.** Baris dengan
      (induk, komponen, mulai berlaku) sama diperbarui; baris lama dengan tanggal
      mulai berbeda tetap berlaku sampai `EFFECTIVE_TO`-nya diisi. Kalau format
      Excel dari SAP hanya memuat komposisi terkini, tambahkan opsi "tutup versi
      lama pada tanggal mulai baru" saat F-48 dikerjakan.
- [ ] **Urai BOM konsumsi membaca seluruh TM_BOM per record MES.** Cukup untuk
      pilot; batch/cache per tanggal bila pengukuran sinkronisasi produksi mulai
      mendekati interval `MES_SYNC_INTERVAL_SEC`.

- [ ] **`WORKER_ONLY` hanya komentar di `queue/queue.module.ts`.** Di `pnpm dev`,
      worker dan API hidup satu proses; render PDF ratusan kanban akan menahan
      event loop dan menyendatkan endpoint scanner. Perlu dikerjakan kalau
      volumenya sudah terasa.
- [ ] **`apps/web` belum punya satu pun test** (`pnpm test` di web hanya mencetak
      pesan). Layar Order Sheet dan form order manual belum terjaga apa pun selain
      typecheck.
- [ ] **Ringkasan receipt hidup di `(app)/receiving/[id]/ringkasan`**, sementara
      layar stasiun di `(station)/receiving/[id]`. Dua route group berbagi awalan
      URL — sah di Next, tapi menambah halaman `/receiving/[id]/<apa pun>` harus
      memilih group dengan sadar.
- [ ] **Tembakan scanner tepat setelah layar disentuh bisa hilang.** Fokus
      dikembalikan lewat `setTimeout(…, 0)` setelah `pointerdown` (pola Avicenna);
      keystroke yang datang di antara sentuhan dan fokus jatuh ke body. Terlihat
      di alat uji; di lapangan jaraknya ratusan milidetik, tapi kalau operator
      mengeluh "scan pertama tidak masuk", inilah sebabnya.
- [ ] **Riwayat scan di layar stasiun hilang saat halaman dimuat ulang** (F-39
      hanya menjaga counter, dari DB). Kalau operator butuh melihat kanban terakhir
      yang discan setelah perangkat mati, isi dari `TT_SCAN_EVENT` saat halaman
      dibuka — datanya sudah ada.
- [ ] **PO cache diisi seed.** `packages/db/src/seed.ts` menulis
      `TT_PO_HEADER`/`TT_PO_LINE` yang seharusnya milik job `sap-sync` (F-44).
      Ditandai `ponytail:` di berkasnya; hapus begitu gateway SAP nyata ada.
      Data ini hanya dibuat bila `SEED_DEMO=on`; seed produksi tidak mengisinya.
