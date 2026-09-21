# Pending ARES

Daftar hal yang menggantung: verifikasi yang belum bisa dijalankan, keputusan
yang menunggu orang, dan utang kecil yang sengaja ditunda. Bukan backlog fitur —
fitur ada di `docs/PRD.md` bagian 12.

Aturan main: satu baris selesai → hapus dari sini, jangan dibiarkan jadi arsip.

Terakhir diperbarui: 2026-09-21 (sesi scan receiving).

## 1. Verifikasi yang belum jalan

(kosong — 2026-09-21: alur receiving lewat HTTP diverifikasi: open → 4 scan OK +
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
- [ ] **Picklist PARTIAL tidak bisa dibuka sesi baru** sampai revisi (F-25, fase 2) ada.
      Kanban MISSING dari sesi pertama baru bisa diterima lewat revisi; dengan
      kebijakan `carry_over` kanban itu mati dan pcs-nya diorder ulang di cutoff
      berikutnya (6.3.2) — belum ada yang mengembalikannya ke antrean (fase 2).
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

- [ ] **`apps/web/src/app/(app)/sap/actions.ts` menelan `redirect('/login')`.**
      Bug yang sama sudah diperbaiki di `picklist/actions.ts` dengan
      `unstable_rethrow(err)` sebagai baris pertama di blok catch; `sap` belum.
      Akibatnya sesi kedaluwarsa muncul sebagai "Tidak bisa menghubungi server".
- [ ] **`WORKER_ONLY` hanya komentar di `queue/queue.module.ts`.** Di `pnpm dev`,
      worker dan API hidup satu proses; render PDF ratusan kanban akan menahan
      event loop dan menyendatkan endpoint scanner. Perlu dikerjakan kalau
      volumenya sudah terasa.
- [ ] **`apps/web` belum punya satu pun test** (`pnpm test` di web hanya mencetak
      pesan). Layar picklist dan form order manual belum terjaga apa pun selain
      typecheck.
- [ ] **`BOX_SHIPPED` selalu NULL** sampai konfirmasi kirim supplier (F-30, 6.3) ada;
      progres sesi scan menampilkan 0 di kolom "dikirim". `TT_RECEIPT_H.NOTE`
      menampung alasan kurang (F-37) sampai `TT_AUDIT_LOG` (F-54) dibuat.
- [ ] **PO cache diisi seed.** `packages/db/src/seed.ts` menulis
      `TT_PO_HEADER`/`TT_PO_LINE` yang seharusnya milik job `sap-sync` (F-44).
      Ditandai `ponytail:` di berkasnya; hapus begitu gateway SAP nyata ada.
      Matikan dengan `SEED_DEMO=off` di server sungguhan.
