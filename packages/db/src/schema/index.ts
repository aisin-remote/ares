/**
 * Skema ARES (PRD bagian 7).
 *
 * Tiga aturan yang dipegang di seluruh skema:
 *  1. Tabel event (TT_CONSUMPTION, TT_KANBAN_EVENT, TT_SCAN_EVENT,
 *     TT_STOCK_MUTATION) bersifat append-only. Koreksi = baris baru, bukan UPDATE.
 *  2. Saldo (stok WH) adalah turunan dari TT_STOCK_MUTATION dan bisa dibangun ulang.
 *  3. Status memakai mysqlEnum dengan transisi eksplisit di packages/domain,
 *     bukan flag teks.
 *
 * Nama tabel TM_/TT_ huruf besar (konvensi MIS), properti camelCase.
 * Fase 1: org, sap, master, picklist (+ receipt, kanban, scan), stock.
 * Menyusul fase 2 (PRD §12): TM_BOM, TT_CONSUMPTION, TT_ORDER_QUEUE,
 * TT_QUEUE_ADJUSTMENT, dan kunci cutoff supplier × jam × tanggal (6.2.4).
 */
export * from './_shared';
export * from './org';
export * from './sap';
export * from './master';
export * from './picklist';
export * from './stock';
