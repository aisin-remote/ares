# ARES — e-Kanban Supplier

Order ke supplier dari konsumsi aktual di line: hasil produksi ditarik dari MES → dikonversi ke kebutuhan komponen per BOM → menumpuk di antrean per supplier → pada jam cutoff menjadi **picklist** + **kanban** (satu QR per box) yang diunduh supplier lewat portal → saat barang datang, picklist dan tiap kanban discan → **Good Receipt** diposting ke SAP lewat outbox.

Spesifikasi: [`docs/PRD.md`](docs/PRD.md). Aturan kerja untuk agen/developer: [`CLAUDE.md`](CLAUDE.md).

> **Status: kerangka.** Auth, shell UI, outbox SAP, queue, dan seed sudah jalan end-to-end. Skema, aturan bisnis, dan modul dibangun per fase (PRD §12), irisan vertikal dulu.

## Arsitektur

Tiga proses, satu database — mengikuti pola Avicenna MES:

```
apps/web    Next 16    UI PPIC/WH, portal supplier, layar stasiun scan, laporan
apps/api    NestJS 11  aturan bisnis, scan handler, worker BullMQ, cron, SAP & MES
packages/   db (Drizzle/MySQL 8.4) · domain (fungsi murni + Vitest) · contracts (zod)
```

Aturan yang dipegang: **baca** langsung dari DB di Server Component, **tulis** selalu lewat API; pekerjaan > 200 ms masuk antrean (BullMQ + Valkey); SAP dan MES hanya disentuh worker lewat gateway + outbox.

## Menjalankan

Prasyarat: Node 20+, pnpm 9, Docker (untuk MySQL 8.4 + Valkey lokal).

```bash
pnpm infra:up                      # MySQL 8.4 + Valkey
cp .env.example .env               # isi DATABASE_URL, REDIS_URL, JWT_SECRET
pnpm install
pnpm db:migrate && pnpm db:seed    # admin: NPK ADMIN / admin123
pnpm dev                           # web http://127.0.0.1:3000, api :3001
```

Perintah lain: `pnpm typecheck`, `pnpm test`, `pnpm db:generate` (setelah mengubah `packages/db/src/schema`).

`.npmrc` mengarah ke mirror publik karena registry.npmjs.org diblokir proxy kantor; ganti ke registry internal bila sudah ada.

## Referensi UI

Tampilan ARES identik dengan Avicenna MES (PRD §10). Sistem desain (`globals.css`), shell, dan primitif `components/ui` sudah ada di repo ini. Pola yang belum dipakai tetapi akan dibutuhkan — stasiun scan, tabel & form master, form penerimaan — disimpan di `docs/reference/avicenna/` sebagai bahan salin, tidak ikut di-compile.

## Integrasi

| Arah | Mekanisme | Status |
| --- | --- | --- |
| MES → ARES (hasil produksi) | job `mes-sync` menarik API MES dengan cursor (PRD 8.2) | `MES_SYNC_ENABLED=false` sampai kontrak API disepakati |
| SAP → ARES (PO open items, master) | job `sap-sync-*` (PRD 8.1) | belum |
| ARES → SAP (GR 101/102) | `TT_SAP_OUTBOX` → `sap-writer` ke tabel staging MS SQL | writer ada, `collect()` masih stub; `SAP_MSSQL_ENABLED=false` |
