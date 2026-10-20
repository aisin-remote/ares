# ARES — panduan untuk agen

ARES = sistem e-Kanban supplier: konsumsi di line (ditarik dari MES) → antrean order → cutoff → Order Sheet + kanban → portal supplier → scan kedatangan → GR ke SAP. Spesifikasi lengkap ada di `docs/PRD.md`; setiap kebutuhan punya nomor (F-xx) dan aturan bisnis punya nomor (6.x). Rujuk nomor itu di komentar dan pesan commit.

Bahasa: komentar, UI, pesan error, dan commit dalam Bahasa Indonesia. Kode (nama variabel/fungsi) Inggris.

## Struktur

```
apps/web        Next 16 — UI PPIC/WH `(app)`, layar stasiun `(station)`, portal supplier `(portal)`, login
apps/api        NestJS 11 — aturan bisnis, scan handler, worker BullMQ, cron, integrasi SAP & MES
packages/db     Drizzle + MySQL 8.4 — skema (PRD §7), client, migrasi, seed
packages/domain fungsi murni + Vitest — aturan PRD §6, tanpa I/O
packages/contracts zod — payload API dan bentuk data bersama
docs/reference/avicenna  pola UI/kode dari Avicenna MES untuk DISALIN, tidak di-compile
```

## Aturan yang tidak boleh dilanggar

1. **Baca vs tulis.** Halaman membaca DB langsung lewat Server Component (`apps/web/src/lib/queries.ts`). Semua perubahan data lewat API Nest (`apps/web/src/lib/api.ts`). Perangkat (scanner, MES) hanya bicara ke API.
2. **> 200 ms → antrean.** Cutoff, sinkron MES/SAP, render PDF, email, pengiriman outbox dikerjakan worker BullMQ, bukan di request. Nama antrean/job ada di `apps/api/src/queue/queue.constants.ts`.
3. **Aturan bisnis hanya di `packages/domain`.** Fungsi murni, input/output data biasa, satu file `.test.ts` per file. Service Nest memanggilnya; tidak ada rumus di controller, service, atau komponen.
4. **Integrasi lewat gateway + outbox.** SAP dan MES dipanggil hanya dari worker lewat interface (`SapGateway`, `MesGateway`) dengan implementasi asli dan `Fake*` untuk test/dev. Request tidak pernah memanggil sistem luar. Keluar ke SAP selalu lewat `TT_SAP_OUTBOX` dengan `IDEMPOTENCY_KEY`.
5. **Idempoten di database.** Scan (`TT_SCAN_EVENT.DEDUPE_KEY`), konsumsi (`TT_CONSUMPTION.SOURCE_KEY`), cutoff (supplier × jam × tanggal), outbox — semuanya punya unique index. Kirim ulang tidak boleh menggandakan.
6. **Skema.** Tabel `TM_` (master) / `TT_` (transaksi), kolom HURUF_BESAR, properti camelCase (Drizzle memisahkannya). Status = `mysqlEnum` + transisi eksplisit di domain, bukan flag `'T'/'F'`. Nomor dokumen dari `TM_SEQUENCE` dengan `SELECT … FOR UPDATE` di dalam transaksi, bukan `MAX()+1`. Simpan UTC, tampilkan Asia/Jakarta.
7. **Tidak ada tabel stok yang diedit langsung.** Stok WH = `SUM(DELTA_PCS)` dari `TT_STOCK_MUTATION` (append-only). Koreksi = baris baru.
8. **UI = sistem desain Avicenna MES + kerangka navigasi Sentra (PRD §10).** Token warna/radius/font di `globals.css`, primitif `components/ui`, halaman, tabel, form, dan stasiun scan mengikuti Avicenna. **Sidebar, brand mark, dan interaksinya** (lipat/buka dengan `PanelLeftClose/Open` di kepala sidebar, tooltip mode ikon, pil aktif meluncur, ikon "mengangguk", `.scroll-hover`) mengikuti Sentra (`AI Project/sentra`) — keputusan pemilik proyek 2026-09-21, **jangan dikembalikan ke sidebar Avicenna**. Dilarang membuat primitif baru, warna di luar token, atau animasi kemunculan dengan Motion (pakai `a-rise`/`a-stagger`). Pola yang belum dipakai ada di `docs/reference/avicenna/` — salin lalu sesuaikan, jangan tulis dari nol.
9. **Portal supplier di-scope di data.** Semua query untuk role `supplier` memakai `vendorId` dari sesi di lapisan query/service, bukan hanya menyembunyikan menu.
10. **Permission per aksi** (`picklist.issue`, `receipt.close`, `receipt.cancel`, `outbox.retry`), dicek di server. Gate per NPK/nama orang dilarang.
11. **Halaman transaksional** memakai `export const dynamic = 'force-dynamic'`; setelah mutasi panggil `revalidatePath`.
12. **Jangan** menambah dependensi untuk hal yang bisa ditulis dalam beberapa baris; jangan menambah modul yang tidak ada di PRD (subcont, claim, delivery adalah fase lanjutan, PRD §12).

## Cara kerja

- Kerjakan per fase PRD §12, irisan vertikal tipis dulu: skema → domain + test → service → halaman.
- Sebelum menulis tabel baru, baca PRD §7; sebelum menulis rumus, baca PRD §6 dan tulis test-nya lebih dulu.
- Selesai satu irisan: `pnpm typecheck && pnpm test`, lalu berhenti dan laporkan; jangan lanjut ke irisan berikutnya tanpa diminta.
- Tandai penyederhanaan yang disengaja dengan komentar `ponytail:` yang menyebut batasnya dan jalan naiknya.

## Perintah

```bash
pnpm infra:up          # MySQL 8.4 + Valkey (docker)
cp .env.example .env   # lalu isi
pnpm install
pnpm db:migrate && pnpm db:seed   # dev: ADMIN/admin123; produksi wajib ADMIN_INITIAL_PASSWORD
pnpm dev               # web :3000, api :3001
pnpm typecheck && pnpm test
pnpm db:generate       # setelah mengubah packages/db/src/schema
```

## Yang sudah ada (per 2026-10-13)

- Skema PRD §7 (migrasi 0000–0020): master supplier per pabrik + pola pengiriman, cutoff + batas reminder F-08, standar order kanban per vendor part, holiday, sequence, Order Sheet H/L + penanda reminder, kanban + event, receipt H/L, scan event, stock mutation, PO cache, permission, `TM_USER.VENDOR_ID`, `TT_AUDIT_LOG`, `TM_BOM`, konsumsi MES, cursor, antrean order, alasan blocked cutoff, kalender pengiriman rutin per pabrik/supplier, status dan jadwal retry SAP outbox, serta challenge dan secret terenkripsi Google Authenticator untuk supplier. Order Sheet dan receipt memiliki `PUBLIC_ID` UUID untuk URL/API; ID numerik tetap internal dan URL lama masih diterima selama transisi.
- Domain: `box.ts` (6.1), `cutoff.ts` (`nextCutoff` dan `nextScheduledDelivery`, 6.2), `picklist.ts` (state machine, PO berlaku, validasi outstanding F-19), `receiving.ts` (8.3 parse kode, 6.4 validasi scan, 6.5 tutup sesi), `shipment.ts` (6.3 konfirmasi dan override kirim; kekurangan selalu recovery dengan RR bertambah), `reminder.ts` (F-08), `bom.ts`, `consumption.ts` (BOM berlaku, vendor part, cutoff berikutnya), serta `sap.ts` (validasi GR terhadap supplier, part, PO, open qty, material, dan UOM).
- API: auth (NPK internal / email supplier + pendaftaran supplier memakai Google Authenticator TOTP, secret AES-GCM, rate limit, persetujuan PPIC/Admin wajib, dan MFA setiap login akun hasil pendaftaran), permission guard, `SequenceService` (Order Sheet 12 digit per plant Aisin PPIC/tanggal delivery + recovery, receipt `RCP-yymmdd-nnnn`), modul `master` (CRUD generik + audit transaksi, F-01–F-09; entitas `bom` + import/pratinjau; `PATCH /master/vendorParts/:id/kemasan` untuk supplier mengubah kemasan vendor part-nya sendiri — hak `vendorPart.self`, hanya kolom `vendorEditable`, audit `UPDATE_BY_VENDOR`, PPIC dikabari lewat job `notify-vendor-part`), modul `stock`, modul `mes` (`MesGateway` fake/http, job repeatable, cursor, ingest idempoten + jalur push `POST /consumption`, koreksi/hold antrean F-13, pembalikan konsumsi OPEN F-15), modul `picklist` (order manual ke semua supplier aktif lewat form/upload Excel, cutoff dijalankan PPIC setelah waktunya tercapai, validasi open qty PO, short shipment, override PPIC), `document` (PDF Order Sheet, PDF kanban 3 kartu/A4, CSV supplier UTF-16LE), `receiving` (cancel + GR reversal 102), audit F-54, SAP outbox dengan alur `PENDING → PROCESSING → STAGED/POSTED`, validasi GR, idempotency key, retry eksponensial maksimal 8 percobaan, dan pemanggilan `SapGateway` di worker di luar transaksi MySQL, modul `notify` (email terbit/revisi, pemberitahuan pendaftaran, dan reminder 15 menit), queue, realtime.
- Hardening produksi: deny-by-default endpoint, permission dan status akun dicek ulang per request, rate limit login per akun/IP, JWT issuer/audience, cookie HttpOnly/Secure, scope vendor+pabrik, security headers/CSP, upload BOM terbatas, API/DB/Valkey bind loopback, dan koneksi DB web SELECT-only. Checklist VPS ada di `docs/SECURITY.md`.
- Web: shell (sidebar lipat ala Sentra, menu tersaring `NEXT_PUBLIC_ARES_PHASE`), login + pendaftaran mandiri supplier, dashboard F-49 termasuk reminder, antrean `PO_OPEN_QTY`, dan Gantt jadwal receiving dari kalender rutin serta transaksi aktual, master + BOM + standar order kanban, stok, setting batas reminder, Order Sheet + koreksi kirim PPIC, receiving + pembatalan/reversal + stasiun scan, SAP dengan ringkasan status, filter tanggal/jenis/status dan detail jadwal retry, portal supplier (termasuk `/portal/vendor-part`: back number, rak, tipe box), `/consumption` (riwayat, gagal, pembatalan), `/mes` (status, tarik manual, input fake), `/queue` (ringkasan supplier, detail cutoff, halaman persiapan untuk koreksi kanban dan hold/release sekaligus, penanda selisih standar, penerbitan setelah cutoff), serta `/display/receiving` untuk monitor read-only dengan sesi perangkat yang diperbarui otomatis.
- Seed produksi: pabrik UNIT, BODY, dan ELECTRIC; 56 supplier unik (25 BODY, 14 UNIT, 17 ELECTRIC). SUPPLIER LIST memberi 39 template cutoff yang menunggu jam/nomor SAP; workbook `List Suppllier Cycle Issue.xlsx` memberi 11 cutoff ELECTRIC aktif lengkap dan 6 supplier `By Schedule` tanpa cutoff tetap. Kode `7D…` menjadi nomor vendor ELECTRIC; HAGIWARA tetap nonaktif karena kodenya kosong. Ada 99 slot diagram untuk Gantt, peran, permission, admin `ADMIN` dengan `ADMIN_INITIAL_PASSWORD`, dan perangkat monitor hanya bila `DISPLAY_DEVICE_TOKEN` diisi. Data master/PO serta akun uji hanya dibuat dengan `SEED_DEMO=on`; login vendor memakai `<kode_vendor>@aiia.co.id`.

Belum ada: laporan F-50–F-52.

Catatan menggantung ada di `docs/PENDING.md` — baca sebelum mulai, hapus baris yang sudah selesai.
