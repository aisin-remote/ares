# Pending ARES

Daftar hal yang menggantung: verifikasi yang belum bisa dijalankan, keputusan
yang menunggu orang, dan utang kecil yang sengaja ditunda. Bukan backlog fitur —
fitur ada di `docs/PRD.md` bagian 12.

Aturan main: satu baris selesai → hapus dari sini, jangan dibiarkan jadi arsip.

Terakhir diperbarui: 2026-09-21 (Fase 2 langkah pertama: BOM, stok WH, menu fase).

## 1. Verifikasi yang belum jalan

- [ ] **Halaman `/stock`, `/stock/[partId]`, dan alat BOM di `/master/bom` belum
      dilihat di browser** (server dev tidak menyala saat dibuat; API & DB-nya
      teruji lewat vitest: import Excel 2 level → explode, dan adjust + audit).
      Cek: `/master/bom` → unggah xlsx 5 kolom → ringkasan baru/diperbarui/dilewati;
      pratinjau urai menampilkan level & daun; `/stock` → klik part → sesuaikan
      dengan alasan → baris ADJUST muncul di buku mutasi.
- [ ] **Menu fase** (`NEXT_PUBLIC_ARES_PHASE`): `.env` dev = 2, jadi Antrean Order,
      Stok WH, Konsumsi, Sinkron MES tampil; laporan (fase 3) tidak. Di server
      pilot biarkan kosong (= 1). Nilai ini dibaca saat build/dev Next — ubah →
      restart `pnpm dev`.

- [ ] **Pengiriman email lewat SMTP sungguhan belum dicoba.** `NotifyService`
      hanya diuji tanpa `SMTP_HOST` (isi email ke log; job `send-notification`
      selesai `{recipients:1, sent:false}` untuk terbit dan revisi). Isi `SMTP_*`
      di `.env` server uji, kirim satu order manual, pastikan email masuk ke akun
      vendor dan tautan portalnya (`WEB_ORIGIN/portal/<id>`) benar.

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

(Selain itu, 2026-09-21: layar stasiun diuji di browser dengan picklist 11 & 42:
buka sesi → kanban picklist lain DITOLAK → OK (tanpa konfirmasi supplier) →
SUDAH DISCAN → kode asing DITOLAK → tutup COMPLETE → ringkasan; lalu sesi kedua
1 dari 2 box → alasan wajib → PARTIAL, ringkasan menampilkan hilang 1. Alur
receiving lewat HTTP diverifikasi: open → 4 scan OK +
dobel DUPLICATE + kanban picklist lain REJECTED + kode asing REJECTED → tutup tanpa
alasan 422 → tutup dengan alasan → picklist PARTIAL, kanban #5 MISSING, 2 baris
TT_STOCK_MUTATION, dan cron `collect-sap-outbox` memungut receipt CLOSED jadi 1 baris
outbox PENDING (GR 101, key RCP-260921-0010) dalam 15 detik.)

## 2. Keputusan yang menunggu orang

- [ ] **Ukuran fisik kartu kanban** (PRD §13, kriteria selesai fase 0: "layout
      kartu kanban disetujui gudang"). Sementara dipakai 105 × 74 mm, 8 kartu per
      A4, terkunci di satu konstanta `KARTU` di
      `apps/api/src/document/kanban-doc.tsx`. Alternatif: A6 (4 per halaman) atau
      label termal 4×6 inci bila supplier ternyata memakai printer label.
- [ ] **Definisi cycle**. Sekarang dihitung dari urutan **jam kedatangan**
      (`ARRIVAL_TIME`), mengikuti glosarium PRD §14 "kedatangan ke-n dalam satu
      hari". Perlu konfirmasi PPIC: di sistem lama, apakah cycle dihitung begitu
      atau dari urutan jam cutoff? Kartu yang sudah tercetak tidak ikut berubah
      (nilainya di-snapshot di `TT_PICKLIST_H.CYCLE`).
- [ ] **Alamat pabrik tujuan tidak ada di `TM_PLANT`**, jadi PDF picklist hanya
      mencetak kode + nama pabrik. Kalau supplier butuh alamat kirim lengkap,
      tambah kolom `ADDRESS` ke `TM_PLANT`.
- [ ] **Sloc GR & stok WH = `SAP_SLOC` (default `WH00`, placeholder PRD §13).**
      Dipakai `TT_STOCK_MUTATION.SLOC` dan payload outbox GR. Begitu tim SAP
      menetapkan sloc, isi di `.env`; baris mutasi lama tidak dimigrasi otomatis.
- [ ] **Satu sesi scan OPEN per picklist, bukan per perangkat (F-34).** Scan ulang
      barcode picklist melanjutkan sesi yang ada (F-39). Kalau gudang memang memakai
      dua stasiun untuk satu truk, perlu `DEVICE_ID` di sesi + dedupe per sesi tetap.
      `TT_RECEIPT_H.DEVICE_ID` dan `TT_SCAN_EVENT.DEVICE_ID` sekarang selalu NULL
      (operator login sebagai user, token device belum dipakai di receiving).
- [ ] **CARRY_OVER belum mengembalikan pcs ke antrean (6.3.2).** `confirmShipment`
      sudah menandai line SHORT dan kanban sisa CANCELLED; `boxShort × qtyPerBox`
      tersedia dari domain, tinggal ditulis ke `TT_ORDER_QUEUE` begitu tabelnya ada
      (fase 2). Sampai saat itu box yang kurang harus diorder ulang manual oleh PPIC.
      Ditandai `ponytail:` di `PicklistService.confirmShipment`.
- [ ] **Tanggal kirim revisi = tanggal asal + 1 hari kalender** (bukan hari kerja
      berikutnya, 6.2). Ikut diperbaiki bersama kalender cutoff fase 2; sampai
      itu PPIC mengecek tanggal revisi yang jatuh di akhir pekan/libur.
- [ ] **Revisi dari revisi.** Konfirmasi kirim rev 1 yang kurang lagi (policy
      REVISION) membuat rev 2 — jalur ini belum diuji; kanban yang sudah RECEIVED
      di rev 0 tidak ikut karena hanya kanban PRINTED yang dipindah.
- [ ] **Picklist PARTIAL tidak bisa dibuka sesi baru** sampai revisi (F-25, fase 2) ada.
      Kanban MISSING dari sesi pertama baru bisa diterima lewat revisi; dengan
      kebijakan `carry_over` kanban itu mati dan pcs-nya diorder ulang di cutoff
      berikutnya (6.3.2) — belum ada yang mengembalikannya ke antrean (fase 2).
- [ ] **Pembatalan receipt setelah GR berstatus `SENT` belum membuat GR pembalik
      102.** F-40 sebelum kirim sudah berjalan: receipt, kanban, picklist, stok,
      dan outbox dipulihkan dalam satu transaksi. Sesudah kirim, API sengaja
      menolak dan meminta proses pembalik; implementasikan setelah kontrak tabel
      staging SAP disepakati.
- [ ] **Picklist yang diterima tanpa konfirmasi supplier** lewat DOWNLOADED → SHIPPED
      otomatis saat sesi ditutup (`picklistStatusPathOnClose`), tanpa mengisi
      `DOWNLOADED_AT`/`SHIPPED_AT`. Penanda "tanpa konfirmasi" hanya ada di
      `TT_KANBAN_EVENT.TYPE = SHIPPED_AUTO`; laporan F-50 harus membacanya dari sana.
- [ ] Pertanyaan terbuka PRD §13 lain (kontrak SAP, mekanisme integrasi, plant &
      sloc GR, kebijakan short shipment default) masih menunggu fase 0 — lihat
      PRD, tidak diulang di sini.

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
      bersihkan tabel transaksi picklist saat mulai serius, atau biarkan.

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
- [ ] **`GET /master/bom/explode` membaca seluruh TM_BOM tiap panggilan** — cukup
      untuk 3.000 vendor part (PRD §9); cache per tanggal kalau F-10 memanggilnya
      per record MES.

- [ ] **`WORKER_ONLY` hanya komentar di `queue/queue.module.ts`.** Di `pnpm dev`,
      worker dan API hidup satu proses; render PDF ratusan kanban akan menahan
      event loop dan menyendatkan endpoint scanner. Perlu dikerjakan kalau
      volumenya sudah terasa.
- [ ] **`apps/web` belum punya satu pun test** (`pnpm test` di web hanya mencetak
      pesan). Layar picklist dan form order manual belum terjaga apa pun selain
      typecheck.
- [ ] **Dua item menu ke halaman yang sama.** "Sesi Scan" → `/receiving?status=OPEN`
      dan "Penerimaan" → `/receiving`; `isActive` sidebar membandingkan pathname
      saja, jadi keduanya menyala bersamaan di halaman itu. Pisahkan kalau
      "Sesi Scan" nanti punya layar sendiri (mis. daftar sesi terbuka per stasiun).
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
- [ ] **`TT_RECEIPT_H.NOTE` menampung alasan kurang (F-37)** dan `TT_PICKLIST_H.NOTE`
      menampung catatan supplier (`Supplier: …`). Perubahan jumlah kirim oleh PPIC
      setelah SHIPPED (6.3.4) belum ada layar/endpoint-nya.
- [ ] **PO cache diisi seed.** `packages/db/src/seed.ts` menulis
      `TT_PO_HEADER`/`TT_PO_LINE` yang seharusnya milik job `sap-sync` (F-44).
      Ditandai `ponytail:` di berkasnya; hapus begitu gateway SAP nyata ada.
      Data ini hanya dibuat bila `SEED_DEMO=on`; seed produksi tidak mengisinya.
