# ARES — panduan untuk agen

ARES = sistem e-Kanban supplier: konsumsi di line (ditarik dari MES) → antrean order → cutoff → picklist + kanban → portal supplier → scan kedatangan → GR ke SAP. Spesifikasi lengkap ada di `docs/PRD.md`; setiap kebutuhan punya nomor (F-xx) dan aturan bisnis punya nomor (6.x). Rujuk nomor itu di komentar dan pesan commit.

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
pnpm db:migrate && pnpm db:seed   # admin: NPK ADMIN / admin123
pnpm dev               # web :3000, api :3001
pnpm typecheck && pnpm test
pnpm db:generate       # setelah mengubah packages/db/src/schema
```

## Yang sudah ada (per 2026-09-21)

- Skema PRD §7 (migrasi 0000–0009): master, cutoff, holiday, sequence, picklist H/L, kanban + event, receipt H/L, scan event, stock mutation, PO cache, permission, `TM_USER.VENDOR_ID`, `TT_AUDIT_LOG`, `TM_BOM`, konsumsi MES, cursor, antrean order, dan alasan blocked cutoff.
- Domain: `box.ts` (6.1), `cutoff.ts` (`nextCutoff`, 6.2), `picklist.ts` (state machine, PO berlaku), `receiving.ts` (8.3 parse kode, 6.4 validasi scan, 6.5 tutup sesi), `shipment.ts` (6.3 konfirmasi kirim, short shipment CARRY_OVER/REVISION), `bom.ts`, `consumption.ts` (BOM berlaku, vendor part, cutoff berikutnya).
- API: auth (NPK internal / email supplier), permission guard, `SequenceService` (`PL-`/`RCP-yymmdd-nnnn`), modul `master` (CRUD generik + audit transaksi, F-01–F-09; entitas `bom` + import/pratinjau), modul `stock`, modul `mes` (`MesGateway` fake/http, job repeatable, cursor, ingest idempoten + jalur push `POST /consumption`, koreksi/hold antrean F-13, pembalikan konsumsi OPEN F-15), modul `picklist` (short shipment CARRY_OVER, pembatalan AUTO mengembalikan pcs, dan job cutoff otomatis F-16/F-18), `document`, `receiving`, audit F-54, SAP outbox + `SapGateway`, modul `notify`, queue, realtime.
- Web: shell (sidebar lipat ala Sentra, menu tersaring `NEXT_PUBLIC_ARES_PHASE`), login, dashboard F-49, master + BOM, stok, setting, picklist, receiving + stasiun scan, SAP, portal supplier, `/consumption` (riwayat, gagal, pembatalan), `/mes` (status, tarik manual, input fake), dan `/queue` (antrean OPEN, alasan blocked, koreksi PCS, hold/release, trigger cutoff manual).
- Seed produksi: pabrik, peran, permission, admin `ADMIN/admin123`. Data master/PO dan akun supplier contoh hanya dibuat dengan `SEED_DEMO=on`.

Belum ada: batas peringatan (F-08), GR pembalik setelah receipt yang sudah `SENT` (sisa F-40), perubahan jumlah kirim oleh PPIC (6.3.4), validasi outstanding terhadap open qty PO (F-19), dan laporan F-50–F-52.

Catatan menggantung ada di `docs/PENDING.md` — baca sebelum mulai, hapus baris yang sudah selesai.
